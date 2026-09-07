-- 0304 — A ledger, so nobody has to guess what has been applied.
--
-- WHY. There has never been a record IN the database of which migration files have run. The only
-- way to answer "what is still pending" was to look at the repo and remember — which means any
-- session, person or tool that cannot see production is guessing. On 2026-09-06 that produced a
-- confident, wrong "28 migrations pending, apply in numeric order" for a database where every one
-- of those 28 had already been applied hours earlier. Pasting it would have been harmless but
-- pointless; the next such guess might not be harmless. The database should be able to answer for
-- itself.
--
-- WHY version IS THE FILENAME AND NOT THE NUMBER. Four files share two numbers:
--
--   0007_fix_grants.sql   and  0007_stop_notes.sql
--   0040_multitenant_foundation.sql  and  0040_checklist_stop_owner.sql
--
-- A ledger keyed on '0007' silently records one of each pair and loses the other, and then reports
-- a complete history that is missing two migrations. The key is the filename without .sql; seq is
-- the leading number, kept separately for ordering and deliberately NOT unique.
--
-- WHAT applied_at MEANS. For rows stamped by a migration as it runs, it is when that migration ran.
-- For the backfill below it is NULL, because that date is not recoverable and inventing one would
-- make the ledger worse than no ledger. recorded_at — when the row itself was written — is always
-- known. evidence says how much each row can be trusted:
--
--   stamped   the migration recorded itself as it ran. Cannot be wrong.
--   verified  backfilled after confirming, against production on 2026-09-07, that a marker the
--             migration leaves behind is present (its changelog row, or an object it creates).
--   inferred  backfilled because the schema these files build is present and the app runs on it.
--             No per-file check was made. Weakest claim in the table; labelled so it reads that way.

create table if not exists public.schema_migrations (
  version       text primary key,                    -- filename without .sql
  seq           int  not null,                       -- leading number; NOT unique (see 0007, 0040)
  applied_at    timestamptz,                         -- when it ran; null for backfilled rows
  recorded_at   timestamptz not null default now(),  -- when this row was written
  applied_by    uuid references auth.users(id) on delete set null,
  applied_count int  not null default 1,             -- a re-run bumps this rather than rewriting history
  evidence      text not null default 'stamped'
                  check (evidence in ('stamped', 'verified', 'inferred')),
  note          text
);
create index if not exists schema_migrations_seq_idx on public.schema_migrations (seq);

alter table public.schema_migrations enable row level security;
-- Staff read it; nothing writes through PostgREST. Migrations run as the service/postgres role in
-- the SQL editor, which RLS does not apply to, so the stamp works without granting anyone write.
drop policy if exists "migrations staff read" on public.schema_migrations;
create policy "migrations staff read" on public.schema_migrations
  for select to authenticated using ((select public.is_staff()));
grant select on public.schema_migrations to authenticated;

comment on table public.schema_migrations is
  'Which migration files have run against this database. Keyed on the filename because four files share two numbers. Written by record_migration() at the end of every migration from 0304 forward; everything before that was backfilled, and the evidence column says how strongly each backfilled row is actually known.';

-- ── the stamp ──────────────────────────────────────────────────────────────────────────────────
-- One line at the end of every migration from 0304 on. Re-running a migration bumps applied_count
-- and refreshes applied_at rather than erroring or silently doing nothing — the file being run twice
-- is a fact worth keeping, not an error worth hiding.
create or replace function public.record_migration(p_version text, p_note text default null)
returns public.schema_migrations language plpgsql security definer set search_path = public as $$
declare r public.schema_migrations; n int;
begin
  if coalesce(btrim(p_version), '') = '' then
    raise exception 'record_migration needs the migration filename, without .sql';
  end if;
  -- The leading digits. A file that does not start with a number has no place in an ordered ledger.
  n := nullif(substring(btrim(p_version) from '^[0-9]+'), '')::int;
  if n is null then
    raise exception 'Migration name must start with its number: got %', p_version;
  end if;

  insert into public.schema_migrations (version, seq, applied_at, applied_by, evidence, note)
  values (btrim(p_version), n, now(), auth.uid(), 'stamped', p_note)
  on conflict (version) do update
     set applied_at    = now(),
         applied_by    = coalesce(auth.uid(), public.schema_migrations.applied_by),
         applied_count = public.schema_migrations.applied_count + 1,
         evidence      = 'stamped',
         note          = coalesce(excluded.note, public.schema_migrations.note)
  returning * into r;
  return r;
end $$;
revoke all on function public.record_migration(text, text) from public, anon, authenticated;

comment on function public.record_migration(text, text) is
  'Records that a migration ran. Called as the last statement of every migration from 0304 forward. Re-running bumps applied_count instead of rewriting the first-applied record away.';

-- ── the backfill ───────────────────────────────────────────────────────────────────────────────
-- Every file present in the repo at 0304. applied_at stays null: these dates are not recoverable.
-- 0267 and up were each confirmed against production on 2026-09-07 by looking for a marker they
-- leave behind, so they are 'verified'. Everything earlier is 'inferred' — the schema is here and
-- the app runs on it, which is real evidence but not per-file evidence, and the column says so.
insert into public.schema_migrations (version, seq, applied_at, evidence, note)
select v,
       substring(v from '^[0-9]+')::int,
       null,
       case when substring(v from '^[0-9]+')::int >= 267 then 'verified' else 'inferred' end,
       case when substring(v from '^[0-9]+')::int >= 267
            then 'Confirmed present in production 2026-09-07 by marker (changelog row or created object).'
            else 'Backfilled at 0304. The schema these build is present and the app runs on it; no per-file check was made.'
       end
  from unnest(array[
  '0001_init','0002_referral_and_display','0003_admin','0004_admins_and_bookings','0005_orders',
  '0006_push_and_loyalty','0007_fix_grants','0007_stop_notes','0008_input_hardening',
  '0009_tighten_low_policies','0010_stop_address','0011_orders_allow_client_paid',
  '0012_auto_loyalty','0013_referral','0014_reserves','0015_subscriptions',
  '0016_security_hardening','0017_cron_holds','0018_order_timestamps','0019_live_truck',
  '0020_subscription_interest','0021_debug_fixes','0022_truck_gps','0023_roles',
  '0024_event_object','0025_event_execution','0026_realtime_and_compliance',
  '0027_compliance_rules','0028_event_economics','0030_academy','0031_academy_governance',
  '0032_event_archive','0033_stop_vendor','0034_vendors','0035_admin_guard_fix',
  '0036_event_tasks_dedupe_warn','0037_trailer_profile','0038_event_approvals',
  '0039_event_approvals_rls_plan_fix','0040_checklist_stop_owner','0040_multitenant_foundation',
  '0041_assets_inventory_postgres','0042_audit_and_integrity','0043_seed_assets',
  '0044_seed_inventory','0045_report_sales','0046_report_snapshot','0047_bi_readonly_role',
  '0048_mrr_and_event_pnl','0049_meeting_notes','0050_alerts','0051_comments',
  '0052_truck_offline_alert','0053_compliance_proposed','0054_seed_branding_studio_note',
  '0055_studio','0056_studio_publish','0057_brand_kit','0058_brand_assets',
  '0059_brand_assets_more','0060_meeting_notes_archive','0061_task_ai_proposal','0062_products',
  '0063_admin_display_name','0064_brand_storage','0065_company_calendar',
  '0067_event_day_planner','0068_outlook_sync','0069_progress_kpis',
  '0070_inspection_research_jobs','0071_inspection_two_phase','0072_production_schedule',
  '0073_clear_stale_content','0074_content_lifecycle','0075_event_lifecycle',
  '0076_fix_tidy_cron_guard','0077_fix_beltline_date','0078_incident_log','0079_brew',
  '0080_brew_timer','0081_perf_and_push_hardening','0082_brew_vessels','0083_asset_maintenance',
  '0084_brew_alert_ladder','0085_seed_brew_gear','0086_brew_log','0087_brewer_text',
  '0088_intake','0089_task_quantities','0090_inventory_ledger','0091_agent_jobs',
  '0092_stop_planning_parity','0093_day_of_brief','0094_stop_crew_signoff','0095_stop_menu',
  '0096_kegs','0097_brew_batch_links','0098_incident_delete','0099_owner_kayla',
  '0100_remove_demo_reserve','0101_seed_uvdtf_kit','0102_profiles_avatar','0103_task_due_date',
  '0104_task_due_alerts','0105_trailer_interior','0106_asset_dimensions',
  '0107_seed_rolling_cooler','0108_scrub_seed_stops','0109_calendar_buffer',
  '0110_trailer_only_rig','0111_content_media','0112_content_media_multi',
  '0113_alert_retention','0114_content_grid_sort','0115_content_stop_link',
  '0116_rename_nature_aide','0117_audit_retention','0118_cancel_own_order','0119_order_ahead',
  '0120_stale_order_alert','0121_event_completion','0122_site_copy','0123_stale_alert_no_flood',
  '0124_set_live_where','0125_stop_completion','0126_drop_fulfillment',
  '0127_menu_reprice_board','0128_restore_tide_broth','0129_sold_out','0130_86_lifecycle',
  '0131_reviews','0132_membership_scan','0133_client_errors','0134_tenant_enforcement',
  '0135_software_billing','0136_reservation_self_service','0137_preorder_window_setting',
  '0138_order_eta_comms','0139_delivery','0140_strategy_collab',
  '0141_customer_record_durability','0142_goals','0143_agent_training','0144_promos_and_bulk',
  '0145_brew_reminder_dedupe','0146_content_campaign','0147_pay_at_pickup',
  '0148_pack_lifecycle','0149_driver_tag','0150_subscriptions_toggle','0151_customer_identity',
  '0152_loyalty_all_channels','0153_order_supertype','0154_rate_limit_store',
  '0155_real_status_columns','0156_orders_server_write_only','0157_alert_spine',
  '0158_tenant_backfill_stragglers','0159_work_streams','0160_stream_nav','0161_lane_pages',
  '0162_lane_pages_2_and_escalation','0163_goal_tracker','0164_goal_moves_on_task_engine',
  '0165_sales_pipeline','0166_deal_models','0167_notes_spine_and_pipeline_home',
  '0168_deal_lines','0169_content_links','0170_note_visibility','0171_rig_canonical',
  '0172_booking_pipeline_bridge','0173_event_menu_items','0174_actionable_alerts',
  '0175_note_partner_attach','0176_founding_members_benefits','0177_notification_prefs',
  '0178_ingredient_science_kb','0179_craft_process_kb','0180_deal_proposals',
  '0181_gt3_voice_story_compare','0182_profile_gender_optional','0183_profile_card_vision',
  '0184_grant_member_editable_columns','0185_events_going_count_real','0186_profile_card_motto',
  '0187_b2b_office_delivery','0188_office_standing_generator','0189_office_pricing_settings',
  '0190_ai_usage_metering','0191_stop_vendor_and_order_ahead',
  '0192_brew_reschedule_on_date_change','0193_b2b_customer_spine','0194_report_events_id',
  '0195_ops_privacy','0196_broadcasts','0197_money_truth','0198_maintenance_log',
  '0199_funnel_events','0200_changelog','0201_initiatives','0202_initiative_flex',
  '0203_vip_verification','0204_identity_spine_vip_reserve','0205_inventory_reorder',
  '0206_office_price_single_authority','0207_readiness_checks','0208_founder_digest',
  '0209_procurement_spend','0210_task_spine','0211_goal_owner','0212_task_visibility',
  '0213_goal_horizon','0214_shoots','0215_inventory_reorder_tenant_scope',
  '0216_tenant_scope_money','0217_vip_private_bucket','0218_todos_private_for_real',
  '0219_stop_sales_attribution','0220_field_ops_and_office_linkage',
  '0221_team_invites_office_paylinks','0222_field_ops_table','0223_field_op_spine',
  '0225_all_tasks_v2','0226_vendor_identity','0227_field_ops_drift_fn','0228_ops_hygiene',
  '0229_loyalty_ledger','0230_webhook_inbox','0231_order_items','0232_identity_integrity',
  '0233_public_visibility','0234_findus_realtime','0235_changelog_designsystem_v1',
  '0236_changelog_dedup','0237_all_tasks_initiatives','0238_orders_integrity',
  '0239_b2b_tenant_isolation','0240_stop_contact_cleanup','0241_changelog_wave2',
  '0242_reserve_gate_cancel_integrity','0243_collapse_readiness_duplicate_lane',
  '0244_drop_orders_idempotency_key','0245_delivery_pack_sizes_6_12_24',
  '0246_customer_row_at_signup','0247_backfill_customer_names','0248_customers_realtime',
  '0249_founding_vip_flag','0250_founding_vip_perks','0251_vip_verify_choice',
  '0252_admin_set_customer_vip','0253_merge_goals_stops_sections','0254_merge_pipeline_section',
  '0255_ops_heartbeat_watchdog','0256_products_drive_economics','0257_customer_live_push',
  '0258_alert_autoexpire','0259_one_company_calendar','0260_admin_audit_trail',
  '0261_batch_traceability','0262_note_continuation','0263_exec_rhythm',
  '0264_gt3_command_registry','0265_pipeline_playbook_enum','0266_seed_8_2_state',
  '0267_utilization','0268_activation_economics','0269_changelog_wave3_no_drift',
  '0270_event_publish_gate','0271_storefront_spine','0272_primal_academy','0274_studio_merch',
  '0275_market_spine','0276_equipment_lifecycle','0277_operator_agreements','0278_shop_media',
  '0279_market_reaches_the_road','0280_role_integrity','0281_offer_letters',
  '0282_market_office_terms','0283_tenant_isolation_gap','0284_compliance_freshness',
  '0285_market_live_switch','0286_offer_letter_statutory','0287_supply_sourcing',
  '0288_inventory_per_market','0289_market_ownership','0290_deal_explainer_record',
  '0291_market_read_scope','0292_receipts_and_spend','0293_count_and_batch_chain',
  '0294_ingredient_map','0295_item_lifecycles','0296_market_readiness',
  '0297_readiness_live_resolution','0298_supply_side','0299_promote_to_crew','0300_batch_steps',
  '0301_one_report_spend','0302_house_voice_is_plural','0303_skew_is_not_critical'
  ]) as v
on conflict (version) do nothing;

-- ── what the ledger can answer ─────────────────────────────────────────────────────────────────
create or replace view public.v_migration_status as
select count(*)                                                as migrations_recorded,
       max(seq)                                                as latest_number,
       (select version from public.schema_migrations order by seq desc, version desc limit 1) as latest_version,
       count(*) filter (where evidence = 'stamped')            as stamped,
       count(*) filter (where evidence = 'verified')           as verified,
       count(*) filter (where evidence = 'inferred')           as inferred,
       count(*) filter (where applied_count > 1)               as run_more_than_once,
       max(applied_at)                                         as last_applied_at
  from public.schema_migrations;

revoke all on public.v_migration_status from public, anon;
grant select on public.v_migration_status to authenticated;

comment on view public.v_migration_status is
  'One row: how much of the migration history this database can account for, and how strongly. The answer to "what is applied" that used to require a person with the repo open.';

-- Numbers with no file recorded against them. 0029, 0066, 0224 and 0273 were empty when the ledger
-- was built — numbers claimed and abandoned before anything shipped under them — so they are named
-- here rather than reported forever as a problem. A gap that is NOT one of those four means a
-- migration exists somewhere that this database has never run.
create or replace view public.v_migration_gaps as
select g.n as missing_number,
       (g.n in (29, 66, 224, 273)) as known_empty_at_0304
  from generate_series(1, (select max(seq) from public.schema_migrations)) g(n)
 where not exists (select 1 from public.schema_migrations m where m.seq = g.n)
 order by g.n;

revoke all on public.v_migration_gaps from public, anon;
grant select on public.v_migration_gaps to authenticated;

comment on view public.v_migration_gaps is
  'Migration numbers this database has no record of running. Four were already empty when the ledger was built and are flagged as such; any other row is a migration that exists but has never been applied here.';

insert into public.changelog (title, category, area, summary, shipped_on, highlight)
select v.title, v.category, v.area, v.summary, v.shipped_on::date, v.highlight
from (values
  ('The database can say what has been applied to it','improvement','System',
   'Until now nothing inside the database recorded which changes had been run against it, so answering "what is still pending" meant someone opening the code and remembering — and anything that could not see production was guessing. One such guess recently named 28 changes as outstanding when every one had already been applied. There is now a ledger: every change from here on records itself as it runs, everything before it has been backfilled, and each entry says how strongly it is actually known rather than pretending to a certainty it does not have.',
   '2026-09-07', true)
) as v(title, category, area, summary, shipped_on, highlight)
where not exists (select 1 from public.changelog c where c.title = v.title);

select public.record_migration('0304_migrations_ledger',
  'The ledger records itself. First stamped row; everything below it is backfill.');

-- verify:
--   select * from public.v_migration_status;
--   select * from public.v_migration_gaps;
--   select version, evidence, applied_at from public.schema_migrations order by seq desc limit 5;
