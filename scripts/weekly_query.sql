-- scripts/weekly_query.sql
-- Aggregates GDELT Events into Weekly R1-R4 counts for risk analysis
-- Parameters: @start_date, @end_date (DATE)

SELECT
  ActionGeo_CountryCode AS iso2,
  FORMAT_DATE('%G-W%V', PARSE_DATE('%Y%m%d', CAST(SQLDATE AS STRING))) AS iso_week,
  COUNT(*) AS event_count,
  SUM(CASE WHEN EventRootCode IN ('18', '19', '20') THEN 1 ELSE 0 END) AS r1_security,
  SUM(CASE WHEN (STARTS_WITH(CAST(EventCode AS STRING), '023') OR EventCode IN ('073', '1033', '1623', '1663')) THEN 1 ELSE 0 END) AS r2_living,
  SUM(CASE WHEN EventRootCode IN ('14', '17') OR EventCode IN ('091', '1121', '104') THEN 1 ELSE 0 END) AS r3_governance,
  SUM(CASE WHEN (STARTS_WITH(CAST(EventCode AS STRING), '162') OR EventCode IN ('1031', '071', '163', '1312', '1311')) THEN 1 ELSE 0 END) AS r4_fiscal
FROM `gdelt-bq.gdeltv2.events`
WHERE SQLDATE >= CAST(REPLACE(@start_date, "-", "") AS INT64)
  AND SQLDATE < CAST(REPLACE(@end_date, "-", "") AS INT64)
  AND ActionGeo_CountryCode IS NOT NULL
  AND LENGTH(ActionGeo_CountryCode) = 2
  -- [P0] SPORTS EXCLUSION (Regex from project standards)
  AND (
    SOURCEURL IS NULL OR (
      NOT REGEXP_CONTAINS(LOWER(SOURCEURL), r'(\/|\.|^)(sport|sports|football|soccer|nba|nfl|mlb|nhl|f1|ufc)(\/|\.|$)')
      AND NOT REGEXP_CONTAINS(LOWER(SOURCEURL), r'espn\.|goal\.com|bleacherreport\.|skysports\.|marca\.com|sports\.yahoo\.')
    )
  )
GROUP BY iso2, iso_week;
