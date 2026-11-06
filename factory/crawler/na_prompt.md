# Task: collect North American (US / Canada) plants of Japanese automotive companies (batch {N})

You are extending an internal sales map of manufacturing plants. The map already has the Japanese domestic plants of
the companies below. Your job: find **every production plant in the United States and Canada** run by each company
or by its subsidiaries / joint ventures, so the sales team can see where Japanese automotive makers and suppliers
produce in North America.

Input: a JSON array of companies ({id, name, legal, industry, group, parent, listed, rev, web, jpFactories}) at
{IN}

Load the web tools first with ToolSearch query "select:WebSearch,WebFetch".

Work company by company. Coverage matters (we want all US/Canada plants), but accuracy beats coverage: never guess.
Unknown fields are null. Budget: big makers/suppliers (revenue > 1兆円) may need 10-30 fetches; small ones 2-6.

## Scope
- Countries: **United States and Canada only**. Mexico and everything else are out of scope (do not list them).
- **Production plants only**: assembly, machining, molding, casting, stamping, component/battery/tire plants, including
  the plants of the company's US/Canadian manufacturing subsidiaries and of joint ventures in which the company is a
  named partner. Exclude: sales/distribution companies, head offices, R&D/technical centers, test courses,
  warehouses/parts distribution centers, service/remanufacturing-only shops, dealerships, closed or announced-but-not-yet-producing plants
  (an announced plant under construction may be listed only if the official source says production has started).
- Domestic Japanese subsidiaries in the input (e.g. トヨタ自動車九州, デンソー九州) normally have no overseas plants of their
  own: check quickly (one search) and return status `no_na_plant` if the North American plants belong to the parent.
  Do not list the parent's plants under the subsidiary.
- If two input companies share a plant (JV), list it under each partner with the same operator and address; it will be de-duplicated later.

## Allowed sources (cite the exact URL for every factory)
- The company's official websites: global site 拠点一覧 / Global network / Locations, the North America regional site
  (e.g. Toyota Motor North America, Honda in America, DENSO North America), and each US/Canadian subsidiary's official site
  (locations, about us, contact pages), official newsroom / press releases on those sites.
- The company's official disclosures: 統合報告書, 有価証券報告書 (関係会社の状況), annual reports, IR fact books.
- Public bodies: US state / Canadian provincial economic-development agencies, city/county governments, JETRO, US federal
  agencies (e.g. EPA facility pages give address only). Mark these `srcType: "public"`.
## Forbidden sources (do not use or cite)
Wikipedia, news media articles (newspapers, trade press, Automotive News, etc.), business directories (ZoomInfo, Dun & Bradstreet,
Manta, Bizapedia, OpenCorporates, Crunchbase, Baseconnect, Salesnow…), job sites (Indeed, Glassdoor, LinkedIn…), map sites
(Google Maps, Mapcarta…), まとめサイト. A value only available from these stays null (a plant that only appears there is not listed).

## Output record per company
```json
{
  "input_id": "id exactly as given",
  "input_name": "name exactly as given",
  "status": "ok | no_na_plant | not_found",
  "na_parent_site": "URL of the company's North America / global locations page you used (null if none)",
  "factories": [
    {
      "name": "plant name as the company calls it, e.g. 'Georgetown Plant', 'TMMK', 'Battle Creek Plant'",
      "name_ja": "short Japanese label, e.g. ケンタッキー工場 (null if unsure)",
      "operator": "legal name of the company that runs the plant, e.g. 'Toyota Motor Manufacturing, Kentucky, Inc.'",
      "operator_ja": "the Japanese input company it belongs to (= input name) or the JP partner for a JV",
      "jv_partners": ["other owners if a JV, else []"],
      "country": "US | CA",
      "state": "full state / province name in English, e.g. 'Kentucky', 'Ontario'",
      "city": "city / town",
      "address": "street address as written by the source, in English, incl. ZIP / postal code (null if only city is known)",
      "products": "what is made there, short JAPANESE phrase ≤ 60 chars (e.g. 乗用車(カムリ・RAV4)の組立 / エンジン / ブレーキ部品)",
      "segment": "business segment if stated, else null",
      "site_area_acres": 1300,      // land area as stated in acres (null if unknown). If stated in m² or ha, put it in site_area_m2 instead
      "site_area_m2": null,
      "floor_area_sqft": 8100000,   // building floor area as stated in sq ft (null if unknown)
      "floor_area_m2": null,
      "employees": 9400,            // null if unknown
      "employees_asof": "2025",     // year or date the source states
      "established": 1988,          // production start year if stated
      "source_url": "https://... page where this plant appears",
      "source_type": "official | yuho | public"
    }
  ],
  "note": "short note: plants you saw but excluded (closed, R&D, Mexico…), ambiguities, sources that blocked fetching"
}
```
Rules:
- The ADDRESS matters: the plant goes on a map. If the locations page has only city names, open the subsidiary's own site
  (contact / locations / footer) to get the street address. City + state is acceptable if nothing better exists; never invent a street.
- One record per physical plant. If a site has several buildings with one address, list it once. If a company lists
  "Plant 1 / Plant 2" at different addresses, list each.
- Numbers are numbers (half-width), not strings. Do not convert units yourself beyond what is asked; give what the source states.
- If WebFetch is blocked (403 etc.) try the site's other pages, a PDF fact book, or a public-body page; note what was blocked.

Write the result as a JSON array (one record per input company, same order as the input) with the Write tool to:
{OUT}

Final reply: only "done: X ok / Y no_na_plant / Z not_found, F factories" and a one-line list of companies you could not resolve.
