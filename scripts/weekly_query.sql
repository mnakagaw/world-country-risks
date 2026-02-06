-- scripts/weekly_query.sql
-- Aggregates GDELT Events into Weekly R1-R4 counts for risk analysis
-- Parameters: @start_date, @end_date (DATE)

SELECT
  ActionGeo_CountryCode AS iso2,
  FORMAT_DATE('%G-W%V', PARSE_DATE('%Y%m%d', CAST(SQLDATE AS STRING))) AS iso_week,
  COUNT(*) AS event_count,
  COUNTIF(${R1_CONDITION}) AS r1_security,
  COUNTIF(${R2_CONDITION}) AS r2_living,
  COUNTIF(${R3_CONDITION}) AS r3_governance,
  COUNTIF(${R4_CONDITION}) AS r4_fiscal
FROM `gdelt-bq.gdeltv2.events_partitioned`
WHERE _PARTITIONDATE BETWEEN @start_date AND @end_date
  AND SQLDATE >= CAST(REPLACE(CAST(@start_date AS STRING), "-", "") AS INT64)
  AND SQLDATE <= CAST(REPLACE(CAST(@end_date AS STRING), "-", "") AS INT64)
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
