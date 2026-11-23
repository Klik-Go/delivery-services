@auth @pilot
Feature: Invite-only soft launch
  The pilot opens to the first 100 invited customers in one barangay (docs/BUSINESS.md §3.3 Tier 1,
  §4.2 Phase 2). Codes come from flyers, partner stores and the waitlist; riders and staff never
  need one.

  Scenario: Without an invite, a customer is asked for a code and cannot order
    Given the pilot is invite-only for 100 customers
    When a new customer signs in during the pilot
    Then they are asked for an invite code after agreeing to the terms
    And placing a cash on delivery order from "Kape't Tinapay" is refused with "Klik Go is invite-only for now"

  Scenario: A customer with a code orders, and the code works only once
    Given the pilot is invite-only for 100 customers
    And an admin creates 3 invite codes in batch "Flyers Poblacion"
    When a new customer signs in during the pilot
    And they enter one of the "Flyers Poblacion" codes
    Then placing a cash on delivery order from "Kape't Tinapay" works
    And another customer cannot use the same code

  Scenario: The pilot stops at its customer limit
    Given the pilot is invite-only and already full
    And an admin creates 1 invite code in batch "Late flyers"
    When a new customer signs in during the pilot
    And they enter one of the "Late flyers" codes
    Then the code is refused with "The pilot is full"

  Scenario: People on the waitlist get their invite by text, once
    Given 2 people are waiting on the waitlist
    And an admin is signed in
    When the admin invites the 2 oldest people on the waitlist
    Then each of them is sent their own invite code
    And inviting the waitlist again sends nothing to them

  Scenario: Food only, and no scheduled orders, while the pilot is small
    Given an admin limits the pilot to food stores and turns off scheduled orders
    When a customer looks at stores around Ayala Avenue
    Then every store they see is a food store
    And checkout offers no delivery times for later
