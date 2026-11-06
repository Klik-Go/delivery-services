@auth @payments
Feature: PayMongo payment confirmations
  PayMongo tells Klik Go about payments with signed webhooks. Each event is stored once before it
  is processed, so retries and replays never pay, credit or refund twice (docs/BUILD_PLAN.md
  Phase 5 acceptance).

  Background:
    Given a signed-in customer delivering to Ayala Avenue, Makati
    And they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "gcash"

  Scenario: A paid confirmation sends the order to the store
    When PayMongo confirms the payment with a gateway fee of 450 centavos
    Then the order is "placed"
    And the payment is "paid" with a fee of 450 centavos
    And the payment is held in the ledger as the customer's deposit

  Scenario: A replayed confirmation changes nothing
    When PayMongo confirms the payment with a gateway fee of 450 centavos
    And PayMongo sends the same confirmation again
    Then the order is "placed"
    And the ledger holds exactly one capture for the order

  Scenario: A confirmation with a bad signature is refused
    When someone sends a payment confirmation with a wrong signature
    Then the webhook answer is 401
    And the order is "awaiting_payment"

  Scenario: A payment that arrives after the order timed out is refunded automatically
    Given the order was cancelled because it was not paid in time
    When PayMongo confirms the payment with a gateway fee of 450 centavos
    Then the order stays "cancelled"
    And the whole payment is refunded through PayMongo
    And the order's ledger balances

  Scenario: A failed payment attempt leaves the order waiting, so the customer can try again
    When PayMongo reports that the payment failed
    Then the webhook answer is 200
    And the order is "awaiting_payment"
