@auth @pilot
Feature: KPI dashboard
  The founder reviews the business and operations KPIs daily during the pilot
  (docs/BUSINESS.md §13; docs/BUILD_PLAN.md Phase 12).

  Scenario: An admin sees today's, this week's and this month's numbers with their targets
    Given a cash on delivery order from "Aling Nena's Karinderya" was delivered today
    And an admin is signed in
    When the admin opens the KPI dashboard
    Then it shows orders, GMV, average order value, completion rate and cash share for today, 7 and 30 days
    And it shows store confirmation time and delivery time against their targets
    And it shows rider utilisation and earnings per online hour
    And a coordinator cannot open the KPI dashboard
