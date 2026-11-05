@auth
Feature: Merchant onboarding
  A karinderya applies on the partner page, an admin approves it, and the owner goes live without
  help (docs/BUSINESS.md §5.4, Appendix A; docs/BUILD_PLAN.md Phase 3).

  Scenario: A store applies from inside the pilot zone and waits for review
    When "Lugaw ni Mang Ben" applies to become a partner with a pin inside Makati
    Then the application is accepted for review
    And an admin sees "Lugaw ni Mang Ben" waiting for review in "Makati City"

  Scenario: A store outside every zone is told we are not there yet
    When "Malayong Kainan" applies to become a partner with a pin outside every zone
    Then the application is accepted for review
    And the applicant is told "We're not in your area yet"
    And an admin cannot approve "Malayong Kainan" until a zone covers it

  Scenario: An admin approves a founding partner and the owner goes live
    Given "Tapsi ni Vivian" has applied to become a partner with a pin inside Makati
    And an admin signed in with their authenticator app
    When the admin approves "Tapsi ni Vivian" as a founding partner at 20% commission
    Then the store "Tapsi ni Vivian" exists, closed, with a public store link
    And it pays 0% commission for its first 90 days, then 20%
    And the admin receives an invite link for the owner
    When the new owner opens the invite link
    And chooses a strong password
    And enrols an authenticator app
    Then they land on the merchant dashboard for "Tapsi ni Vivian"

  Scenario: Only admins approve or reject applications
    Given "Bibingka ni Aling Rosa" has applied to become a partner with a pin inside Makati
    And the owner of "Aling Nena's Karinderya" signed in with their authenticator app
    When they try to approve "Bibingka ni Aling Rosa"
    Then they are refused with status 403

  Scenario: An admin rejects an application with a reason
    Given "Fishball Express" has applied to become a partner with a pin inside Makati
    And an admin signed in with their authenticator app
    When the admin rejects "Fishball Express" because "Mobile cart, no fixed address"
    Then "Fishball Express" is no longer waiting for review

  Scenario: The partner form cannot be flooded from one network
    Given a network that has not sent partner applications yet
    When it sends 5 partner applications
    And it sends one partner application more
    Then the request is refused with code "RATE_LIMITED"
