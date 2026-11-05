@auth
Feature: Sessions stay fresh and logging out ends them
  Scenario: An expired access token is refreshed automatically
    Given a customer signed in with a phone code
    And their access token has expired
    When they check who is signed in
    Then they are still signed in
    And they received a new access token

  Scenario: Logging out revokes the session
    Given a customer signed in with a phone code
    When they log out
    Then their old session no longer works
    And their old refresh token is rejected
