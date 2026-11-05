@auth
Feature: Browse and search
  Customers see the stores that deliver to their pin, grouped into rails, and can search dishes
  and stores, even with a typo (docs/BUSINESS.md §9.2.1; docs/BUILD_PLAN.md Phase 4).

  Scenario: The home feed shows the stores near the customer
    Given a customer delivering to Ayala Avenue, Makati
    When they open the home feed
    Then "Near you" lists "Kape't Tinapay" and "Aling Nena's Karinderya"
    And every store shows a delivery fee and an arrival time range
    And "Under ₱100" lists "Kape't Tinapay"
    And the promo carousel shows "LIBREHATID"

  Scenario: A dish search finds the dish under its store
    Given a customer delivering to Ayala Avenue, Makati
    When they search for "adobo"
    Then the results include "Adobong Manok" from "Aling Nena's Karinderya"

  Scenario: A store search tolerates a typo
    Given a customer delivering to Ayala Avenue, Makati
    When they search for "kape tinapy"
    Then the results include the store "Kape't Tinapay"

  Scenario: A customer outside every zone sees no stores
    Given a customer delivering to Kapitolyo, Pasig
    When they open the home feed
    Then they see no stores and are invited to join the waitlist
