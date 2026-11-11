@auth @ops
Feature: Zone coordinators run live orders from the admin console
  Coordinators watch their zone's orders with SLA colours and step in when something goes wrong:
  they assign or reassign a rider, cancel, refund and leave notes, always with a reason, and every
  action is written to the audit log (docs/BUSINESS.md §5.5, §9.2.4; docs/BUILD_PLAN.md Phase 8).

  Background:
    Given riders "Rosa Rider" and "Rico Rider" are online near Kape't Tinapay, Rosa the nearest
    And a signed-in customer delivering to Ayala Avenue, Makati
    And they ordered 2 "Kapeng Barako" with "Less sugar" from "Kape't Tinapay" paying "cod"
    And the owner of "Kape't Tinapay" is signed in
    And the owner accepted the order with a prep time of 15 minutes
    And the Makati coordinator is signed in

  Scenario: The board shows the order with its SLA colour
    When the coordinator opens the order board
    Then the order is on the board as "preparing" and "on time"
    When the order has been preparing for 13 minutes
    Then the order is on the board as "preparing" and "at risk"
    When the order has been preparing for 16 minutes
    Then the order is on the board as "preparing" and "late"

  Scenario: The order detail tells its story
    When the coordinator opens the order
    Then the order history reads "placed by customer, accepted by merchant_owner, preparing by merchant_owner"

  Scenario: Assign a rider by hand
    When the coordinator assigns "Rico Rider" to the order because "Rico is at the store already"
    Then "Rico Rider" is delivering the order
    And Rosa's offer for the order has been withdrawn
    And the audit log records "order.assign_rider" by the coordinator because "Rico is at the store already"

  Scenario: Reassign the order to another rider
    Given "Rosa Rider" accepted the offer
    When the coordinator assigns "Rico Rider" to the order because "Rosa's motorbike broke down"
    Then "Rico Rider" is delivering the order
    And "Rosa Rider" has no job
    And the audit log records "order.reassign_rider" by the coordinator because "Rosa's motorbike broke down"

  Scenario: An order is reassigned only to an approved rider who is free
    When the coordinator assigns "Rey Rider" to the order because "Testing"
    Then the request is refused with code "CONFLICT"

  Scenario: Cancel with a reason
    When the coordinator cancels the order because "Customer unreachable for 20 minutes"
    Then the order is "cancelled"
    And the audit log records "order.cancel" by the coordinator because "Customer unreachable for 20 minutes"

  Scenario: Every action needs a reason
    When the coordinator cancels the order because ""
    Then the request is refused with code "VALIDATION_FAILED"

  Scenario: Support notes stay with the order
    When the coordinator adds the note "Customer asked us to call on arrival"
    Then the order shows the note "Customer asked us to call on arrival" by the coordinator
    And the audit log records "order.note" by the coordinator
