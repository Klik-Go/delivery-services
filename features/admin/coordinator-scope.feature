@auth @ops
Feature: A coordinator only sees and changes their own zone
  Each zone is run by its coordinator; other zones' orders, riders and settings are out of reach,
  in the service and in the database (docs/BUILD_PLAN.md Phase 8 acceptance).

  Background:
    Given a signed-in customer delivering to Ayala Avenue, Makati
    And they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    And a coordinator of "San Fernando, Pampanga" is signed in

  Scenario: Another zone's orders are invisible
    When the coordinator opens the order board
    Then the order is not on the board
    When the coordinator opens the order
    Then the request is refused with code "NOT_FOUND"
    When the coordinator cancels the order because "Not mine"
    Then the request is refused with code "NOT_FOUND"

  Scenario: Another zone's settings are out of reach
    When the coordinator changes the "Up to 2 km" fee of "Makati City" to ₱45.00
    Then the request is refused with code "FORBIDDEN"

  Scenario: Platform settings are for admins only
    When the coordinator sets the dispatch offer time to 45 seconds
    Then the request is refused with code "FORBIDDEN"
