@auth @rider
Feature: A rider delivers the order
  The rider goes to the store, picks up and delivers; cash is collected on delivery, big orders
  need the customer's PIN and the rest a photo, and delivery settles the money (docs/BUSINESS.md
  §5.2 steps 5–6, §5.3).

  Background:
    Given riders "Rosa Rider" and "Rico Rider" are online near Kape't Tinapay, Rosa the nearest
    And a signed-in customer delivering to Ayala Avenue, Makati

  Scenario: A cash order from accept to delivery
    Given they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod" with a 2000 centavo tip
    And the owner of "Kape't Tinapay" is signed in
    And the owner accepted the order with a prep time of 15 minutes
    And "Rosa Rider" accepted the offer
    Then Rosa's job shows the landmark, a masked contact number and "Collect ₱199.00"
    When "Rosa Rider" arrives at the store
    And "Rosa Rider" tries to pick up the order
    Then the request is refused with code "CONFLICT"
    When the owner marks the order ready
    And "Rosa Rider" picks up the order
    Then the order is "picked_up"
    When "Rosa Rider" delivers the order with a photo
    Then the order is "delivered"
    And the order's ledger balances
    And Rosa holds ₱199.00 more cash and earned her pay plus the ₱20.00 tip today

  Scenario: Big orders need the customer's delivery PIN
    Given they ordered 10 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    And the customer's order shows a 4-digit delivery PIN
    And the owner of "Kape't Tinapay" is signed in
    And the owner accepted the order with a prep time of 15 minutes
    And "Rosa Rider" accepted the offer
    And the owner marks the order ready
    And "Rosa Rider" picks up the order
    When "Rosa Rider" delivers the order with a photo
    Then the request is refused with code "VALIDATION_FAILED"
    When "Rosa Rider" delivers the order with the PIN "0000"
    Then the request is refused with code "VALIDATION_FAILED"
    When "Rosa Rider" delivers the order with the customer's PIN
    Then the order is "delivered"

  Scenario: The customer sees the rider only while the rider has their order
    Given they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    And the owner of "Kape't Tinapay" is signed in
    And the owner accepted the order with a prep time of 15 minutes
    Then the customer's tracking shows no rider yet
    When "Rosa Rider" accepts the offer
    And "Rosa Rider" shares her location near the store
    Then the customer's tracking shows Rosa on the map with an arrival estimate
    When the owner marks the order ready
    And "Rosa Rider" picks up the order
    And "Rosa Rider" delivers the order with a photo
    Then the customer's tracking shows no rider

  Scenario: Location is shared only while online
    When "Rosa Rider" goes offline
    And "Rosa Rider" shares her location near the store
    Then the request is refused with code "CONFLICT"
