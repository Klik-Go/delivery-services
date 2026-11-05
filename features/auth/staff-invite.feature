@auth
Feature: Staff join by invitation and must use two-factor sign-in
  Merchant, coordinator and admin accounts are invite-only and protected by an
  authenticator app (TOTP). Staff screens need the second factor (AAL2).

  Scenario: An invited merchant owner sets a password, enrols an authenticator and reaches the dashboard
    Given an admin signed in with their authenticator app
    And the admin has invited a new owner for "Aling Nena's Karinderya"
    When the new owner opens the invite link
    And chooses a strong password
    And enrols an authenticator app
    Then they land on the merchant dashboard

  Scenario: Only admins can invite staff
    Given a customer signed in with a phone code
    When they try to invite a merchant owner
    Then the request is refused with code "FORBIDDEN"

  Scenario: Staff without the second factor cannot open staff screens
    Given a merchant owner who signed in with only their password
    When they open "/merchant"
    Then they are sent to "/auth/mfa"
