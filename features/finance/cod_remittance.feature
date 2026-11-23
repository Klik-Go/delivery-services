@auth @finance
Feature: Cash on delivery: netting and hand-ins
  Cash a rider collects on delivery is Klik Go's money. Whatever a rider still holds at the weekly
  settlement is taken off their earnings, and coordinators record the cash riders hand in, which
  frees their cash limit (docs/BUILD_PLAN.md Phase 10, OPEN_QUESTIONS Q31).

  Scenario: Cash a rider still holds is netted against their earnings
    Given an admin is signed in
    And a finished week in which rider "Rico" collected 30000 centavos in cash and earned 8000 centavos
    When the admin settles that week
    Then "Rico" is paid 0 centavos with 8000 centavos of cash netted
    And "Rico" still holds 22000 centavos of that week's cash

  Scenario: The coordinator records cash a rider hands in
    Given rider "Rico" holds at least 1000 centavos of cash
    And the Makati coordinator is signed in
    When the coordinator records 1000 centavos handed in by "Rico" with reference "Hub OR-0001"
    Then "Rico" holds 1000 centavos less cash
    And recording more than "Rico" holds is refused
    And the audit log records "cash.received" by the coordinator
