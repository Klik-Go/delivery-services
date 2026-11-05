@db
Feature: People only see their own data
  Customers, merchants and riders share one database, so row-level security decides who
  sees what (CLAUDE.md "RLS is enabled on every table").

  Background:
    Given the pilot zone from the seed data
    And a merchant "Aling Nena's" at the centre of the pilot zone with staff member "Sam"
    And a merchant "Kape't Tinapay" at the centre of the pilot zone
    And a rider "Rico" on duty in the pilot zone
    And a rider "Rosa" on duty in the pilot zone
    And customer "Carmen" has an order from "Aling Nena's" that "Rico" is delivering
    And customer "Diego" has an order from "Kape't Tinapay" offered to "Rosa"

  Scenario: A customer sees only their own orders
    When "Carmen" looks at orders
    Then "Carmen" sees exactly these orders: Carmen from Aling Nena's

  Scenario: Merchant staff see only their store's orders
    When "Sam" looks at orders
    Then "Sam" sees exactly these orders: Carmen from Aling Nena's

  Scenario: A rider sees an order only once it is offered or assigned to them
    When "Rosa" looks at orders
    Then "Rosa" sees exactly these orders: Diego from Kape't Tinapay

  Scenario: A customer can follow the rider delivering their order, and nobody else
    When "Carmen" looks at rider locations
    Then "Carmen" sees the location of "Rico" only

  Scenario: A visitor who is not signed in sees no orders
    When a visitor who is not signed in looks at orders
    Then they see no orders

  Scenario: Rider ID documents are visible to admins only
    Given "Rico" has uploaded a government ID
    Then the zone coordinator cannot see "Rico"'s ID documents
    And "Rosa" cannot see "Rico"'s ID documents
    And an admin can see "Rico"'s ID documents
