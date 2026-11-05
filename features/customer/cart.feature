@auth
Feature: The server prices the cart
  The browser only sends item ids and choices; every price, fee and total comes from the server,
  and the cart shows the server's quote (docs/BUILD_PLAN.md Phase 4 acceptance).

  Background:
    Given a customer delivering to Ayala Avenue, Makati

  Scenario: Items, choices, the delivery fee and the small-order fee are priced by the server
    When they ask for a quote for 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay"
    Then the subtotal is 12000 centavos
    And the delivery fee is 3900 centavos for a trip under 2 km
    And a small-order fee of 2000 centavos applies
    And the total is 17900 centavos

  Scenario: A price change on the menu shows up in the next quote
    Given "Kapeng Barako" at "Kape't Tinapay" now costs ₱65
    When they ask for a quote for 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay"
    Then the subtotal is 13000 centavos

  Scenario: Paid choices are added to the item price
    When they ask for a quote for 1 "Adobong Manok" with "Garlic rice" from "Aling Nena's Karinderya"
    Then the subtotal is 10500 centavos

  Scenario: A sold-out dish is flagged and left out of the total
    Given "Ensaymada" at "Kape't Tinapay" is sold out
    When they ask for a quote for 1 "Ensaymada" and 1 "Pandesal (10 pcs)" from "Kape't Tinapay"
    Then "Ensaymada" is flagged as sold out
    And the subtotal is 4000 centavos

  Scenario: A required choice must be made
    When they ask for a quote for 1 "Kapeng Barako" without choosing from "Kape't Tinapay"
    Then "Kapeng Barako" is flagged as needing a choice
