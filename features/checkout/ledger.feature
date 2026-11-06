@auth @ledger
Feature: The ledger balances for every order
  Klik Go keeps a double-entry ledger: in every transaction the debits equal the credits, and so
  the ledger of every order balances (docs/BUILD_PLAN.md Phase 5 acceptance, docs/BUSINESS.md §5.2
  steps 6–7).

  Background:
    Given a signed-in customer delivering to Ayala Avenue, Makati
    And they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "gcash"
    And PayMongo confirms the payment with a gateway fee of 450 centavos

  Scenario: A captured payment balances
    Then the order's ledger balances
    And the gateway fee of 450 centavos is recorded as an expense

  Scenario: An admin refunds part of an order
    Given a signed-in admin
    When the admin refunds 2000 centavos of the order because "Missing coffee"
    Then the payment is "partially_refunded" with 2000 centavos refunded
    And the refund is recorded with reason "Missing coffee"
    And the order's ledger balances

  Scenario: A refund can never exceed what was paid
    Given a signed-in admin
    When the admin refunds 50000 centavos of the order because "Too much"
    Then the request is refused with code "VALIDATION_FAILED"

  Scenario: Customers cannot refund their own orders
    When the customer tries to refund their own order
    Then the request is refused with code "FORBIDDEN"
