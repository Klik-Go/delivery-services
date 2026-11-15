@auth @retention @promos
Feature: Promo codes with caps, eligibility and abuse guards
  Admins create campaign codes: percent off with a cap, a fixed amount, or free delivery, limited
  to new customers, a zone or a store, a minimum order, uses per customer and a total peso budget.
  A customer can use a code once per account, phone number and device (docs/BUILD_PLAN.md Phase 9).

  Background:
    Given an admin is signed in

  Scenario: A new-customer code works on the first order only
    Given the admin creates a "fixed_off" campaign worth 5000 centavos for new customers only
    And a new customer "Mara" signs in on their phone
    Then the campaign takes 5000 centavos off "Mara"'s checkout
    Given "Mara" has had an order delivered
    Then "Mara"'s checkout says "That promo code is for your first order only."

  Scenario: The same device cannot use a code twice, even with another account
    Given the admin creates a "percent_off" campaign worth 1000 basis points capped at 3000 centavos
    And a new customer "Mara" signs in on device "handset-0001-aaaa-bbbb"
    And "Mara" places a cash order with the campaign
    And a new customer "Dodong" signs in on device "handset-0001-aaaa-bbbb"
    Then "Dodong"'s checkout says "You have already used that promo code."
    And "Mara"'s checkout says "You have already used that promo code."

  Scenario: A campaign stops at its peso budget
    Given the admin creates a "fixed_off" campaign worth 5000 centavos with a budget of 8000 centavos
    And a new customer "Mara" signs in on their phone
    And "Mara" places a cash order with the campaign
    And a new customer "Dodong" signs in on their phone
    Then "Dodong"'s checkout says "That promo code has been used up."

  Scenario: Admins switch campaigns off; coordinators cannot manage them
    Given the admin creates a "free_delivery" campaign capped at 4000 centavos
    When the admin switches the campaign off
    And a new customer "Mara" signs in on their phone
    Then "Mara"'s checkout says "That promo code is not valid right now."
    And the audit log records "promo.deactivate" by the admin
    Given the Makati coordinator is signed in
    Then the coordinator cannot list or create campaigns
