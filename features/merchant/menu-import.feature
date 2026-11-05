@auth
Feature: Import a menu from a photo
  A merchant photographs a printed menu and gets draft items to review. Nothing reaches the menu
  until the merchant confirms (docs/BUILD_PLAN.md Phase 3, AI menu import).

  Background:
    Given the owner of "Aling Nena's Karinderya" signed in with their authenticator app

  Scenario: Reading a menu photo creates drafts only
    When they import a photo of their printed menu
    Then they see draft items with prices and how sure the reader is about each
    And none of the drafts is on the menu yet

  Scenario: Confirmed drafts are added to the menu in their categories
    When they import a photo of their printed menu
    And they confirm the drafts after changing the price of "Halo-halo" to ₱85
    Then "Halo-halo" costs 8500 centavos on the menu
    And the menu has a "Desserts" category

  Scenario: Only images can be imported
    When they import a text file as their menu
    Then the request is refused with code "VALIDATION_FAILED"
