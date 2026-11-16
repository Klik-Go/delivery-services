@auth @finance
Feature: Weekly reports and the bookkeeper's export
  Admins read GMV, take rate, contribution per order, refunds, promo cost and cash-on-delivery share
  by zone and week, and export the ledger mapped to the chart of accounts (docs/BUSINESS.md §6.5).

  Scenario: The week's report by zone, and CSVs that open in Google Sheets
    Given an admin is signed in
    And a finished week with 2 delivered orders in Makati: one cash order and one paid online
    When the admin opens that week's report
    Then Makati shows 2 orders, a GMV of 56000 centavos, a 25% take rate and a 50% cash share
    And the report CSV opens cleanly in a spreadsheet
    And the ledger CSV lists the week's rows with account codes from the chart of accounts
    And coordinators cannot open reports
