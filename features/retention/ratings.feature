@auth @retention
Feature: Two-sided ratings after delivery
  After delivery the customer rates the store and the rider separately (1 to 5 stars, quick tags
  and a comment), and the rider rates the customer. One rating per order and target, given within
  7 days of delivery and changeable for 24 hours. A rating of 2 or less opens a ticket for the
  zone's coordinator (docs/BUSINESS.md §5.3).

  Background:
    Given a signed-in customer delivering to Ayala Avenue, Makati
    And they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"

  Scenario: The customer rates the store and the rider once the order is delivered
    Given the order has been delivered by rider "Rico"
    When the customer rates the store 5 stars with "tasty, hot_food" and the rider 4 stars
    Then the rating sheet shows the store at 5 stars and the rider at 4 stars
    And the order counts in "Kape't Tinapay"'s rating average

  Scenario: Ratings open only after delivery and close 7 days later
    When the customer rates the store 5 stars
    Then the rating is refused with "You can rate an order once it has been delivered."
    Given the order was delivered 8 days ago by rider "Rico"
    When the customer rates the store 5 stars
    Then the rating is refused with "Ratings close 7 days after delivery."

  Scenario: A rating can be changed for 24 hours, then it is locked
    Given the order has been delivered by rider "Rico"
    And the customer rated the store 3 stars
    When the customer rates the store 4 stars
    Then the rating sheet shows the store at 4 stars
    Given the store rating was given 25 hours ago
    When the customer rates the store 5 stars
    Then the rating is refused with "Your store rating can no longer be changed."

  Scenario: A low rating opens a ticket for the zone's coordinator
    Given the order has been delivered by rider "Rico"
    When the customer rates the store 2 stars with "cold_food"
    Then the Makati coordinator sees a low-rating ticket for the order
    When the coordinator marks the ticket done with "Called the store; sent a voucher"
    Then the ticket is done and the audit log records "ticket.resolve"

  Scenario: The rider rates the customer; other riders cannot
    Given the order has been delivered by rider "Rico"
    When rider "Rico" rates the customer 5 stars with "ready_at_door"
    Then the customer's average from riders includes 5 stars
    And rider "Rosa" cannot rate the customer of that order
