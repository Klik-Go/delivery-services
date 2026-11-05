@auth
Feature: Customers and riders sign in with their phone
  Customers and riders sign up with a phone number and a one-time code
  (docs/BUSINESS.md §9.2.1 "phone number OTP sign-up"). Numbers are stored as +63.

  Scenario: A new customer signs up with a one-time code and lands on Home
    Given a customer with the test phone number "0917 000 0101"
    When they sign in with their phone and the code "123456"
    Then they land on Home signed in as "+639170000101"

  Scenario: A wrong code is refused
    Given a customer with the test phone number "0917 000 0102"
    When they sign in with their phone and the code "000000"
    Then they are told the code is wrong
    And they are not signed in

  Scenario: A number that is not a Philippine mobile is refused before any code is sent
    When someone asks for a code for "02 8123 4567"
    Then the request is refused with code "VALIDATION_FAILED"
