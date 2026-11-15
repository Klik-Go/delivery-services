@auth @retention
Feature: Order history and "Order again"
  The customer sees their past orders, newest first, and can order one again. The same items are
  priced today and anything sold out or gone from the menu is flagged (docs/BUSINESS.md §9.2.1).

  Background:
    Given a signed-in customer delivering to Ayala Avenue, Makati
    And they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"

  Scenario: Past orders show newest first, and "Order again" uses today's prices
    Given they ordered 1 "Ensaymada" from "Kape't Tinapay" paying "cod"
    When they open their order history
    Then the newest order lists "1× Ensaymada" and the one before it "2× Kapeng Barako"
    Given "Kapeng Barako" at "Kape't Tinapay" now costs 6500 centavos
    When they order the Kapeng Barako order again
    Then "Order again" offers 2 "Kapeng Barako" at 6500 centavos each, all available

  Scenario: "Order again" flags sold-out items and keeps the rest
    Given they ordered 1 "Ensaymada" from "Kape't Tinapay" paying "cod"
    And "Ensaymada" at "Kape't Tinapay" is sold out
    When they order the Ensaymada order again
    Then "Order again" flags "Ensaymada" as "sold_out"
    And someone else cannot order that order again
