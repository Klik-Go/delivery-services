@auth @retention
Feature: Referrals: ₱50 for both friends
  Every customer has a referral code. A new customer enters a friend's code before their first
  order; once that order is delivered both get a ₱50 voucher. Guards: no self-referral, codes are
  for first orders only, one referral per device, and a first order sent to the referrer's own
  address does not count (docs/BUSINESS.md §4.2).

  Scenario: Both friends get a ₱50 voucher after the friend's first delivered order
    Given a new customer "Rina" signs in on their phone
    And a new customer "Paolo" signs in on their phone
    When "Paolo" enters "Rina"'s referral code
    And "Paolo"'s first order is delivered
    And the platform runs its background jobs
    Then "Rina" and "Paolo" each have a 5000 centavo voucher
    And "Paolo"'s voucher takes 5000 centavos off their checkout

  Scenario: Codes can't be used on yourself, after a first order, or twice on one phone
    Given a new customer "Rina" signs in on device "handset-0002-cccc-dddd"
    And a new customer "Paolo" signs in on device "handset-0002-cccc-dddd"
    And a new customer "Tess" signs in on device "handset-0002-cccc-dddd"
    Then "Rina" entering "Rina"'s referral code is refused with "That's your own code. Share it with a friend."
    When "Paolo" enters "Rina"'s referral code
    Then "Tess" entering "Rina"'s referral code is refused with "A referral code was already used on this phone."
    Given a new customer "Lito" signs in on their phone
    And "Lito" has had an order delivered
    Then "Lito" entering "Rina"'s referral code is refused with "Referral codes are for your first order only."

  Scenario: A first order sent to the referrer's own address earns nothing
    Given a new customer "Rina" signs in on their phone
    And "Rina" has had an order delivered
    And a new customer "Paolo" signs in on their phone
    When "Paolo" enters "Rina"'s referral code
    And "Paolo"'s first order is delivered to "Rina"'s address
    And the platform runs its background jobs
    Then "Paolo"'s referral is void and nobody has a referral voucher
