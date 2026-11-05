@db
Feature: Orders and money cannot be corrupted
  Money is stored in whole centavos and every order total must add up. An order moves
  forward one step at a time through its lifecycle, and every change is recorded
  (docs/BUSINESS.md §5.2, docs/ARCHITECTURE.md §4).

  Background:
    Given the pilot zone from the seed data
    And a merchant "Silog Express" at the centre of the pilot zone
    And customer "Carmen" has placed a cash-on-delivery order from "Silog Express"

  Scenario: An order whose total does not add up is refused
    When the order is saved with subtotal ₱200.00, delivery fee ₱39.00, discount ₱10.00 and total ₱250.00
    Then the change is refused

  Scenario: An order whose total adds up is accepted
    When the order is saved with subtotal ₱200.00, delivery fee ₱39.00, discount ₱10.00 and total ₱229.00
    Then the change is accepted

  Scenario: An order cannot skip steps
    When the order status is changed to "delivered"
    Then the change is refused

  Scenario: Every status change is recorded with who made it
    When the merchant owner of "Silog Express" accepts the order
    Then the order history reads "placed" then "accepted" by a "merchant_owner"

  Scenario: The ledger only accepts balanced transactions
    When a ledger transaction debits ₱100.00 and credits ₱90.00
    Then the change is refused
