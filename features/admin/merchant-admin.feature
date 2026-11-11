@auth @ops
Feature: Admins manage live stores
  Admins can suspend a store and change its commission from a date (docs/BUSINESS.md §9.2.4).

  Background:
    Given an admin is signed in

  Scenario: A suspended store disappears for customers
    When the admin suspends "Milk Tea ni Juan" because "Food safety complaint"
    Then customers can no longer open "Milk Tea ni Juan"
    And the audit log records "merchant.suspend" by the admin because "Food safety complaint"
    When the admin reactivates "Milk Tea ni Juan"
    Then customers can open "Milk Tea ni Juan" again

  Scenario: A commission change waits for its date
    When the admin sets the commission of "Silog Express" to 15% from tomorrow
    Then "Silog Express" still pays its current commission today
    And from tomorrow "Silog Express" pays 15%
    And the audit log records "merchant.commission" by the admin
