@auth
Feature: The first admin is bootstrapped from ADMIN_EMAIL
  The owner creates the first admin with a script (never a hard-coded account); the
  admin then sets a password and enrols TOTP like any other staff member.

  Scenario: Bootstrapping is safe to run more than once
    Given an ADMIN_EMAIL that has no Klik Go account yet
    When the owner runs the bootstrap-admin script
    Then that account is an admin
    And the script prints a one-time "invite" link
    When the owner runs the bootstrap-admin script again
    Then that account still has exactly one admin role
    And the script prints a one-time "recovery" link
