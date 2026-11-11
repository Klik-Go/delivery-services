@auth @dispatch
Feature: Dispatch offers each job to the nearest suitable rider
  When the store accepts an order, Klik Go offers the delivery to the nearest online rider who can
  carry it; each offer shows the pay up front and lasts 30 seconds (docs/BUSINESS.md §5.2 step 4,
  docs/BUILD_PLAN.md Phase 7).

  Background:
    Given riders "Rosa Rider" and "Rico Rider" are online near Kape't Tinapay, Rosa the nearest
    And a signed-in customer delivering to Ayala Avenue, Makati
    And they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    And the owner of "Kape't Tinapay" is signed in

  Scenario: The nearest online rider is offered the job when the store accepts
    When the owner accepts the order with a prep time of 15 minutes
    Then "Rosa Rider" is offered the job, with her pay shown and 30 seconds to answer
    And "Rey Rider" is never offered the job

  Scenario: A declined offer goes straight to the next nearest rider
    Given the owner accepted the order with a prep time of 15 minutes
    When "Rosa Rider" declines the offer
    Then "Rico Rider" is offered the job

  Scenario: An unanswered offer expires and goes to the next rider
    Given the owner accepted the order with a prep time of 15 minutes
    And Rosa's offer has been waiting for 31 seconds
    When the platform runs its background jobs
    Then Rosa's offer has expired
    And "Rico Rider" is offered the job

  Scenario: A rider who already carries too much cash is skipped for cash orders
    Given "Rosa Rider" already holds ₱2,950 in cash with a ₱3,000 limit
    When the owner accepts the order with a prep time of 15 minutes
    Then "Rico Rider" is offered the job

  Scenario: Offline riders are never offered a job
    Given "Rosa Rider" goes offline
    When the owner accepts the order with a prep time of 15 minutes
    Then "Rico Rider" is offered the job

  Scenario: When every rider declines, the zone coordinator is alerted
    Given the owner accepted the order with a prep time of 15 minutes
    When "Rosa Rider" declines the offer
    And "Rico Rider" declines the offer
    Then the order is flagged for the zone coordinator as unassigned

  Scenario: A rider can only accept their own offer, once
    Given the owner accepted the order with a prep time of 15 minutes
    When "Rico Rider" tries to accept Rosa's offer
    Then the request is refused with code "NOT_FOUND"
    When "Rosa Rider" accepts the offer
    Then "Rosa Rider" is delivering the order
    When "Rosa Rider" accepts the offer again
    Then the request is refused with code "CONFLICT"
