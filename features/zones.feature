@db
Feature: Delivery zones
  Each zone is a mini-franchise with its own service area (docs/BUSINESS.md §5.5).
  Klik Go only delivers to addresses inside an active zone.

  Background:
    Given the pilot zone from the seed data

  Scenario: An address inside the pilot zone is served
    When a customer drops a pin at the centre of the pilot zone
    Then the address is served by the pilot zone

  Scenario: An address far outside every zone is not served
    When a customer drops a pin 50 km north of the pilot zone centre
    Then no zone serves the address

  Scenario: A paused zone takes no orders
    Given the pilot zone is paused
    When a customer drops a pin at the centre of the pilot zone
    Then no zone serves the address

  Scenario: A merchant must be inside its zone
    When a merchant tries to register 40 km north of the pilot zone centre
    Then the merchant is not saved
