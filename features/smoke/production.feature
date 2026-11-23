@smoke
Feature: Production smoke test
  Run after every production deploy and every morning of the pilot (docs/LAUNCH.md): the app is
  up, the database is migrated, customers can find the test store and price a cart, and the test
  customer can sign in and check out. Only public API calls, no database access, so it runs
  against production. Placing (and at once cancelling) a cash order is opt-in.

  Scenario: The public pages answer
    When a visitor opens the privacy notice, the terms and the partner page
    Then each of them answers 200

  Scenario: Customers can find the test store and price a cart
    When a visitor looks for stores at the smoke-test location
    Then the smoke-test store is listed and open to orders
    And its menu prices a cart on the server

  Scenario: The test customer can sign in and check out
    Given the smoke-test customer signs in
    When they open checkout for the smoke-test store
    Then checkout offers cash on delivery
    And when order placing is enabled for the smoke test, an order is placed and cancelled at once
