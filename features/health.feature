@smoke
Feature: Platform health
  As the Klik Go operations team
  We need to know the platform is up before a zone takes orders
  So that customers, merchants and riders are never left waiting on a dead app

  Scenario: A customer opens Klik Go and sees the brand
    Given the platform is running
    When I open the home page
    Then I see the Klik Go brand
    And I see the tagline "Delivered to your door, wherever you are."

  Scenario: Monitoring checks that the platform is healthy
    Given the platform is running
    When monitoring calls GET "/api/health"
    Then the response status is 200
    And the response body has data.status "ok"
    And the response carries a request id
