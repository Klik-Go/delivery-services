@auth @rider @pabili
Feature: Pabili, a rider buys a shopping list for the customer
  Customers in a barangay with few partner stores send a free-text shopping list for any store,
  palengke or sari-sari store. A rider whose float covers the customer's budget buys the items
  with cash, photographs the receipt and delivers; the customer pays the receipt total plus the
  fees in cash (docs/BUILD_PLAN.md §4 "Pabili mode", Phase 13; docs/OPEN_QUESTIONS.md Q38).

  Background:
    Given Pabili is switched on with a ₱1,500.00 item limit and a ₱49.00 fee
    And riders "Rosa Rider" and "Rico Rider" are online near Kape't Tinapay, Rosa the nearest
    And a new customer of their own, signed in and delivering to Ayala Avenue, Makati

  Scenario: The list is priced with the zone's delivery fee and the Pabili fee
    When the customer asks for the price of a Pabili list from "Aling Nena Sari-sari" with a ₱500.00 limit
    Then the Pabili fees are ₱39.00 delivery and ₱49.00 Pabili fee
    And the most they will pay at the door is ₱588.00

  Scenario: A Pabili order from list to doorstep
    Given "Rico Rider" can spend up to ₱1,000.00 on Pabili items and "Rosa Rider" nothing
    When the customer sends a Pabili list from "Aling Nena Sari-sari" with a ₱500.00 limit
    Then the order is taken by Klik Go without any store
    And "Rico Rider" is offered the job
    And "Rosa Rider" is never offered the job
    Given "Rico Rider" accepted the offer
    When "Rico Rider" starts shopping
    And "Rico Rider" records a ₱312.50 receipt with a photo, "Pandesal" not available
    Then the customer sees ₱312.50 for the items, ₱400.50 to pay at the door and a link to the receipt
    When "Rico Rider" picks up the order
    And "Rico Rider" delivers the order with a photo
    Then the Pabili order is delivered after these steps: placed, accepted, preparing, ready, picked_up, delivered

  Scenario: The rider cannot record more than the customer's limit
    Given "Rico Rider" can spend up to ₱1,000.00 on Pabili items and "Rosa Rider" nothing
    And the customer sent a Pabili list from "Aling Nena Sari-sari" with a ₱500.00 limit
    And "Rico Rider" accepted the offer
    And "Rico Rider" started shopping
    When "Rico Rider" records a ₱500.01 receipt with a photo, "Pandesal" not available
    Then the purchase is refused with "over the customer's budget"
    And the customer's Pabili order is still being shopped

  Scenario: The customer cancels before a rider takes the list
    When the customer sends a Pabili list from "Aling Nena Sari-sari" with a ₱500.00 limit
    And the customer cancels the Pabili order
    Then the Pabili order is cancelled

  Scenario: A limit above the admin's item cap is refused
    When the customer asks for the price of a Pabili list from "Aling Nena Sari-sari" with a ₱1,500.01 limit
    Then the Pabili request is refused with "most a rider can spend"

  Scenario: Nothing is sent while Pabili is switched off
    Given Pabili is switched off
    When the customer asks for the price of a Pabili list from "Aling Nena Sari-sari" with a ₱500.00 limit
    Then the Pabili request is refused with "Pabili isn't available"
