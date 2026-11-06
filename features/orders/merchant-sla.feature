@auth @sla
Feature: Stores confirm orders within 3 minutes
  A store must confirm a new order within 3 minutes or it is cancelled and any payment refunded
  (docs/BUSINESS.md §5.4). The platform texts the store at 1 minute and flags the order to the
  zone coordinator at 2 minutes.

  Background:
    Given a signed-in customer delivering to Ayala Avenue, Makati

  Scenario: The store is texted when an order waits a minute
    Given they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    And the order has waited 61 seconds for the store
    When the platform checks the store deadlines
    Then a text to "Kape't Tinapay" about the order is queued
    And the order is "placed"

  Scenario: The zone coordinator is alerted after two minutes
    Given they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    And the order has waited 121 seconds for the store
    When the platform checks the store deadlines
    Then the order is flagged for the zone coordinator

  Scenario: An order the store never confirms is cancelled after three minutes
    Given they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    And the order has waited 181 seconds for the store
    When the platform checks the store deadlines
    Then the order is "cancelled" because "merchant_timeout"
    And the customer is told the store did not confirm

  Scenario: A paid order the store never confirms is refunded
    Given they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "gcash"
    And PayMongo confirms the payment with a gateway fee of 450 centavos
    And the order has waited 181 seconds for the store
    When the platform checks the store deadlines
    And the platform runs its background jobs
    Then the order is "cancelled" because "merchant_timeout"
    And the whole payment is refunded through PayMongo
    And the order's ledger balances

  Scenario: Only the platform's scheduler may run background jobs
    When someone runs the background jobs without the scheduler's secret
    Then the jobs answer is 401
