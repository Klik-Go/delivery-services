@db
Feature: Database foundations
  Zones and rider dispatch rely on PostGIS (doc §5.5), and SLA timers such as
  the 3-minute merchant acceptance window rely on scheduled jobs (pg_cron).

  Scenario Outline: The <purpose> extension is enabled after migrations
    Given the database has been migrated
    Then the "<extension>" extension is enabled

    Examples:
      | purpose         | extension |
      | geo             | postgis   |
      | scheduled jobs  | pg_cron   |
