@auth
Feature: Menu management
  Merchants build their own menu: categories, items in pesos, modifiers, photos and sold-out
  toggles (docs/BUSINESS.md §9.2.2; docs/BUILD_PLAN.md Phase 3).

  Background:
    Given the owner of "Aling Nena's Karinderya" signed in with their authenticator app

  Scenario: An owner adds a dish with a required rice choice
    When they add the category "Silog Meals"
    And they add "Tapsilog" to "Silog Meals" for ₱120.50 with a required "Rice" choice of "Plain rice" or "Garlic rice" (+₱15)
    Then "Tapsilog" costs 12050 centavos on the menu
    And "Tapsilog" has a required "Rice" choice with "Garlic rice" at 1500 centavos extra

  Scenario: Categories can be put in a new order
    When they add the categories "Drinks" and "Desserts"
    And they move "Desserts" to the top
    Then "Desserts" is the first category on the menu

  Scenario: A sold-out dish shows as unavailable on the public store page
    Given the menu has "Pancit Bihon" for ₱90
    When they mark "Pancit Bihon" as sold out
    Then the public store page shows "Pancit Bihon" as sold out

  Scenario: Staff of one store cannot change another store's menu
    Given a staff member of "Kape't Tinapay" signed in with their authenticator app
    When the staff member tries to rename a category of "Aling Nena's Karinderya"
    Then they are refused with status 403
    And the categories of "Aling Nena's Karinderya" are unchanged

  Scenario: Menu photos are WebP of at most 200 KB and go into the store's own folder
    When they ask to upload a 150 KB WebP photo
    Then they get an upload link for a file in their store's folder
    And a 150 KB WebP photo uploads to that link
    And storage refuses a 300 KB file even with an upload link
    When they ask to upload a 300 KB WebP photo
    Then the request is refused with code "VALIDATION_FAILED"
