@auth @demo-riders
Feature: Demo riders for showing the rider app and the rider console
  The owner loads demo riders into the hosted app: approved riders online near the demo stores in
  every launch zone, riders off shift, applicants waiting for KYC review with placeholder
  documents, a suspended rider and a rider on the coaching list. Each signs in with a test number.

  Scenario: Loading the demo riders gives every launch zone riders ready for job offers
    When the owner loads the demo riders
    Then every launch zone has a demo rider who is approved, online and placed near a demo store
    And the KYC queue has the demo applicants, each with all five placeholder documents
    And "Dina Ramos" has the government ID accepted and four documents waiting for review
    And "Edwin Castro" is suspended with the reason shown to the console
    And the console lists "Carlo Bautista" for coaching
    And demo rider "Faye Mercado" can sign in with the test number and is online in San Fernando

  Scenario: Loading again resets the demo, and hiding takes every demo rider off shift
    Given the owner loads the demo riders
    And a reviewer has accepted every document of "Hazel David" and approved the rider
    When the owner loads the demo riders again
    Then "Hazel David" is waiting for KYC review again with five documents to check
    And no demo rider has a second account or a second set of documents
    When the owner hides the demo riders
    Then no demo rider is online or approved
