@auth @lifecycle
Feature: The order lifecycle
  The store confirms each order and prepares it; every change is recorded and reaches the customer
  (docs/BUSINESS.md §5.2 steps 2–3, docs/BUILD_PLAN.md Phase 6).

  Background:
    Given a signed-in customer delivering to Ayala Avenue, Makati
    And they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    And the owner of "Kape't Tinapay" is signed in

  Scenario: The store accepts with a prep time and the order is being prepared
    When the owner accepts the order with a prep time of 20 minutes
    Then the order is "preparing"
    And the order history reads "placed, accepted, preparing"
    And the customer's order shows it is being prepared, ready in about 20 minutes

  Scenario: The store marks the order ready
    Given the owner accepted the order with a prep time of 15 minutes
    When the owner marks the order ready
    Then the order is "ready"

  Scenario: The store rejects with a reason
    When the owner rejects the order because "Out of coffee beans"
    Then the order is "rejected"
    And the customer's order shows "The store couldn't take this order" with the reason "Out of coffee beans"

  Scenario: The customer can cancel before the store accepts
    When the customer cancels the order
    Then the order is "cancelled"

  Scenario: The customer cannot cancel once the store has accepted
    Given the owner accepted the order with a prep time of 15 minutes
    When the customer cancels the order
    Then the request is refused with code "CONFLICT"

  Scenario: A store cannot see or accept another store's order
    Given the owner of "Aling Nena's Karinderya" is signed in instead
    When the owner accepts the order with a prep time of 20 minutes
    Then the request is refused with code "NOT_FOUND"
    And the order is "placed"

  Scenario: An order cannot skip a step
    When the owner marks the order ready
    Then the request is refused with code "CONFLICT"
    And the order is "placed"

  Scenario: The store's order board lists the new order
    When the owner opens the order board
    Then the board shows the order under "New" with 2 "Kapeng Barako"
