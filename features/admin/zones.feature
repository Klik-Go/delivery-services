@auth @ops
Feature: Admins edit zones and their fees
  Zones have a drawn area, fees, a radius, hours and a coordinator. Fee changes apply to new
  quotes only; placed orders keep the fees they were charged (docs/BUSINESS.md §9.2.4).

  Background:
    Given an admin is signed in

  Scenario: A fee change affects new quotes only
    Given a signed-in customer delivering to Ayala Avenue, Makati
    And they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    When the admin changes the "Up to 2 km" fee of "Makati City" to ₱45.00
    Then a new quote for 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" has a ₱45.00 delivery fee
    And the order placed before still has a ₱39.00 delivery fee
    And the audit log records "fee_rule.update" by the admin

  Scenario: Redraw a zone's area
    When the admin redraws "San Marcelino, Zambales" as a square around 14.97, 120.16
    Then "San Marcelino, Zambales" covers 14.97, 120.16
    And the audit log records "zone.update" by the admin

  Scenario: A self-crossing area is refused
    When the admin redraws "San Marcelino, Zambales" as a bow tie
    Then the request is refused with code "VALIDATION_FAILED"

  Scenario: Give a zone its coordinator
    Given a coordinator of "San Marcelino, Zambales" is signed in
    When the admin makes them the coordinator of "San Marcelino, Zambales"
    Then "San Marcelino, Zambales" lists them as its coordinator
