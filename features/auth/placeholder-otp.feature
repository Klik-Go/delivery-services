@auth @placeholder-otp
Feature: Customers sign in with the test code while text messages are off
  Before SMS is switched on, the Klik Go team gives testers one shared 6-digit code
  (owner decision 2026-11-05, docs/OPEN_QUESTIONS.md Q20). It works with any Philippine
  mobile number, and only for customers. It stops working once SMS is configured.

  Scenario: A new customer with a DITO number signs in with the test code
    Given a new customer with a DITO mobile number
    When they sign in with their phone and the test code
    Then they land on Home signed in with that number

  Scenario: A returning customer gets the same account back
    Given a new customer with a DITO mobile number
    And they have signed in with the test code before
    When they sign in with their phone and the test code
    Then they are signed in to the same account as before

  Scenario: A rider's number cannot use the test code
    Given the rider number "0917 000 0021"
    When they sign in with their phone and the test code
    Then they are told to use the code that was texted to them
    And they are not signed in
