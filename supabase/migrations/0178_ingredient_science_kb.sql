-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 0178 · INGREDIENT SCIENCE — grounds the concierge (+ all agents) in sourced, compliant facts
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- The concierge could describe drinks but not EXPLAIN the ingredients. These agent_knowledge rows
-- (agent='concierge') flow into its prompt as authoritative OWNER CORRECTIONS. Every fact is
-- web-sourced; every row carries its own boundary so the AI self-polices. Compliance line, binding:
-- describe composition + generally-recognized properties; NEVER disease/cure/treat/detox claims,
-- allergen safety, or personalized medical advice. Idempotent by title.

insert into public.agent_knowledge (agent, title, body, author_name)
select v.agent, v.title, v.body, 'Ingredient science (researched)'
from (values
  ('concierge', 'Ingredient · Cold extraction / cold brew',
   $b$Our coffee is cold-extracted — steeped slow in cool water for many hours instead of rushed with heat — which many people find smoother and less bitter. MAY say: smoother, less bitter, brewed without heat. MUST NOT say it is "less acidic so easier on your stomach" (a health claim) or quote a "% less acid" figure — the science on acidity is mixed (measured pH is often similar to hot brew). Source: Rao & Fuller, Scientific Reports (Nature) 2018.$b$),
  ('concierge', 'Ingredient · A2 grass-fed goat milk',
   $b$Goat milk is naturally an A2 milk (predominantly A2 beta-casein, so it does not form the BCM-7 peptide A1 cow casein can), tends to form smaller softer curds, and is a bit LOWER in lactose than cow milk (~4.1 vs ~4.7-5 g/100 g). MAY say: naturally an A2 milk, some people find it easier to digest, lower in lactose than cow milk. MUST NOT say: "lactose-free," "safe for a milk allergy," or that it treats any condition — it is still dairy and still has lactose. Source: PMC5932946.$b$),
  ('concierge', 'Ingredient · Organic maple syrup (sweetener)',
   $b$We sweeten with real maple syrup instead of refined sugar — it is unrefined (boiled-down sap, not chemically stripped), so it keeps trace minerals like manganese and zinc, and has a lower glycemic index than table sugar (~54 vs ~65). MAY say all of that. MUST NOT say "safe for diabetics," "won't spike blood sugar," or "healthy sugar" — it is still mostly sugar; describe it as a better-choice sweetener, not a blood-sugar solution. Sources: maple review PMC10469071; INTEGRIS Health.$b$),
  ('concierge', 'Ingredient · Sea salt',
   $b$A pinch of sea salt adds sodium — the body's primary electrolyte for fluid balance — which is why a little salt supports hydration around sweat and exertion, plus it rounds out flavor. MAY say: sodium supports hydration/electrolyte balance, adds minerals and flavor. MUST NOT say sea salt is "healthier than table salt" (its trace-mineral edge is nutritionally tiny) or that it "detoxifies" or "balances pH." Standard hydration physiology; trace-mineral point per nutrition science.$b$),
  ('concierge', 'Ingredient · Organic coconut water (RISE, Nature''s Aide)',
   $b$Coconut water is the naturally sweet liquid of young green coconuts, genuinely rich in potassium (plus some sodium, magnesium, manganese) — a whole-food source of electrolytes; a 2025 controlled study found it rehydrated about as well as a sports drink despite less sodium. MAY say: naturally high in potassium, a whole-food electrolyte source. MUST NOT say "the most hydrating drink," "superior to water," or make medical rehydration claims. Note it is naturally lower in sodium than dedicated sport formulas. Sources: PMC10534364; Mayo Clinic.$b$),
  ('concierge', 'Ingredient · Organic cacao nibs (FLOW)',
   $b$Cacao nibs are crushed roasted cacao beans — chocolate in its whole, unsweetened form — a natural source of magnesium and cocoa flavanols, and they carry theobromine, a gentler longer-acting cousin of caffeine that gives a smoother, steadier lift; the nibs themselves have only modest caffeine (~10-14 mg/tbsp). MAY say: whole cacao, natural source of magnesium and flavanols, theobromine gives a gentler lift than coffee. MUST NOT claim it "improves blood flow / heart / mood / focus" — flavanol health studies use concentrated doses, not a spoon of nibs. Sources: theobromine explainers; cacao nutrition.$b$),
  ('concierge', 'Ingredient · Ceylon cinnamon + green cardamom (DUSK)',
   $b$We use Ceylon — "true cinnamon" from Sri Lanka — which is naturally very LOW in coumarin (~0.017 mg/g) unlike common cassia cinnamon (~1-12 mg/g); that is a quality/composition choice. Green cardamom is an aromatic ginger-family spice, there mainly for warmth and aroma. MAY say: we use true Ceylon cinnamon, naturally low in coumarin; cardamom for flavor and aroma. MUST NOT say cinnamon or cardamom "lowers blood sugar," "reduces inflammation," or treats anything. Source: Healthline (Ceylon vs cassia; EFSA coumarin TDI 0.1 mg/kg).$b$),
  ('concierge', 'Ingredient · Bone broth',
   $b$Bone broth is bones and connective tissue slow-simmered for hours, drawing out collagen (which becomes gelatin), amino acids like glycine and proline, and minerals — a savory whole-food source of protein (often ~8-10 g/cup). MAY say: whole-food source of protein and collagen, naturally contains amino acids and minerals. MUST NOT say it "heals your gut," "cures leaky gut," "builds cartilage," or "boosts immunity" — those are the overreaches regulators watch; collagen-for-skin/joints evidence is still emerging. Sources: Harvard Nutrition Source; Cleveland Clinic.$b$),
  ('concierge', 'Ingredient · Nitro cold brew (KING ME)',
   $b$Nitro is cold brew infused with nitrogen gas — nothing added but the gas. Nitrogen makes extremely tiny bubbles (far smaller than soda's CO2) for the cascading pour, velvety head, and creamy mouthfeel with no dairy, sugar, or cream. MAY say all of that — texture and process language is fair. MUST NOT frame it as "healthier" or "less acidic so easier on your stomach" — nitro is a texture-and-experience story, not a health story. Physics of N2 low solubility / small bubbles is standard.$b$),
  ('concierge', 'Ingredient · Whole-food philosophy (the honest clean-energy answer)',
   $b$Every drink is built from whole, recognizable foods — coffee, goat milk, maple syrup, coconut water, cacao, spices, sea salt, broth — with NO refined sugar, NO seed oils, and NO synthetic preservatives, colors, or flavors (minimally processed, not ultra-processed). If someone asks whether it "detoxes," is "clean energy," or "doesn't burden your body," answer honestly: it is clean because of WHAT IS IN IT — nothing artificial — not because of anything it does to the body. NEVER use the word "detox," never claim it "flushes toxins" or gives energy the body "doesn't have to process," and never say seed oils/additives are "harmful" (mainstream science does not support that — it is a formulation choice, not a health verdict). Sources: Harvard Nutrition Source; NOVA classification.$b$)
) as v(agent, title, body)
where not exists (select 1 from public.agent_knowledge k where k.title = v.title);

-- verify:
--   select count(*) from public.agent_knowledge where title like 'Ingredient ·%' and active;  -- 10
