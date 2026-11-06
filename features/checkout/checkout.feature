@auth @checkout
Feature: Placing an order
  A signed-in customer orders one store's cart from a single checkout screen. Prices, fees,
  promos and the total are always worked out by Klik Go, never taken from the phone
  (docs/BUSINESS.md §5.2 step 1, docs/BUILD_PLAN.md Phase 5).

  Background:
    Given a signed-in customer delivering to Ayala Avenue, Makati

  Scenario: Cash on delivery goes straight to the store
    When they order 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    Then the order is "placed" with a KG- code
    And the order charges 17900 centavos
    And the order history starts with "placed"

  Scenario: An online payment waits for PayMongo
    When they order 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "gcash"
    Then the order is "awaiting_payment" with a KG- code
    And they are sent to a payment page

  Scenario: Tapping "Place order" twice creates one order
    When they send the same order twice with one Idempotency-Key paying "cod"
    Then both answers name the same order
    And only one order exists for that key

  Scenario: Reusing an Idempotency-Key for a different cart is refused
    Given they placed an order with an Idempotency-Key paying "cod"
    When they send a different cart with that Idempotency-Key
    Then the request is refused with code "CONFLICT"

  Scenario: A promo code lowers the total
    When they order 5 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod" with promo "kaintayo"
    Then the order charges 28900 centavos
    And the promo "KAINTAYO" is redeemed once for that order

  Scenario: A rider tip is added to the total
    When they order 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod" with a 2000 centavo tip
    Then the order charges 19900 centavos

  Scenario: A promo below its minimum order is refused
    When they order 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod" with promo "KAINTAYO"
    Then the request is refused with code "VALIDATION_FAILED"
    And no order was created

  Scenario: A closed store does not take orders for now
    Given "Kape't Tinapay" is closed
    When they order 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    Then the request is refused with code "CONFLICT"

  Scenario: A sold-out dish cannot be ordered
    Given "Ensaymada" at "Kape't Tinapay" is sold out
    When they order 1 "Ensaymada" from "Kape't Tinapay" paying "cod"
    Then the request is refused with code "VALIDATION_FAILED"

  Scenario: Cash on delivery is refused where the store does not accept it
    Given "Kape't Tinapay" does not accept cash on delivery
    When they order 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    Then the request is refused with code "VALIDATION_FAILED"

  Scenario: Only signed-in customers can place orders
    When someone who is not signed in places an order
    Then the request is refused with code "UNAUTHORIZED"
