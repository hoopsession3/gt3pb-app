-- Product name correction: it's "Nature Aide" (owner-confirmed), never "Nature Aid".
-- Earlier seeds (0028, 0043) are already applied, so fix the live rows forward here.
-- Internal keys stay 'nature_aid' — only the human-facing label/text changes.

update public.product_economics
   set label = 'Nature Aide'
 where product_key = 'nature_aid' and label = 'Nature Aid';

update public.assets
   set use_case = replace(use_case, 'Nature Aid', 'Nature Aide')
 where use_case like '%Nature Aid%' and use_case not like '%Nature Aide%';
