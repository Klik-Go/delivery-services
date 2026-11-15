@auth @retention
Feature: Loyalty stamps: every 10th order earns free delivery
  Each delivered order of ₱150 or more earns a stamp; 10 stamps become a free-delivery voucher
  (docs/BUSINESS.md §4.2, §9.2.1).

  Scenario: The 10th stamp turns into a free-delivery voucher
    Given a new customer "Lola" signs in on their phone
    And "Lola" has 9 stamps
    When "Lola"'s order of 20000 centavos is delivered
    And the platform runs its background jobs
    Then "Lola" has a free-delivery voucher and an empty stamp card
    And "Lola"'s voucher takes the delivery fee off their checkout

  Scenario: Small orders earn no stamp
    Given a new customer "Lola" signs in on their phone
    When "Lola"'s order of 10000 centavos is delivered
    And the platform runs its background jobs
    Then "Lola"'s stamp card shows 0 stamps
