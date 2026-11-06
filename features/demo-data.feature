@auth @demo
Feature: Demo data for showing Klik Go
  The owner loads demo stores into the hosted app to show it end to end: open stores with full
  menus in every launch zone, promo codes, delivery fees and one store owner account.

  Scenario: Loading the demo gives every launch zone open stores customers can order from
    Given a demo store owner email that has no Klik Go account yet
    When the owner loads the demo data
    Then every launch zone has demo stores customers can open, with full menus and cash on delivery
    And a customer in San Fernando can price an order from "Kusinang Kapampangan"
    And the demo owner manages all the demo stores
    And the script prints a one-time "invite" link

  # The home feed is cached per zone for a minute, so hidden stores leave it within 60 seconds.
  Scenario: Loading twice changes nothing, and hiding takes the stores off the app
    Given a demo store owner email that has no Klik Go account yet
    And the owner loads the demo data
    When the owner loads the demo data again
    Then the demo menus are not duplicated
    When the owner hides the demo data
    Then the demo stores in San Fernando can no longer be opened by customers
