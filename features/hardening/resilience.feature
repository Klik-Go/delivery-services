@auth @resilience
Feature: Keep taking orders when a partner is down
  When the payment gateway or the maps provider fails, Klik Go keeps working in a simpler mode
  instead of turning customers away (docs/BUSINESS.md §12 "Payment gateway downtime").

  Scenario: Online payments are paused and customers pay cash on delivery
    Given an admin pauses online payments
    And a signed-in customer with a cart from "Kape't Tinapay"
    When the customer opens checkout
    Then cash on delivery is the only way to pay
    And placing a GCash order is refused with "Online payment is paused. Pay cash on delivery."
    And placing a cash on delivery order works

  Scenario: A flat delivery fee while distances cannot be trusted
    Given an admin turns on the flat delivery fee
    When a customer asks for a quote from "Kape't Tinapay" to a nearby and to a farther address
    Then both quotes charge the zone's base delivery fee

  Scenario: Address search is down and the customer drops the pin themselves
    Given address search is unavailable
    When a signed-in customer searches for "Ayala Triangle"
    Then they are told to drop the pin on the map themselves
    And saving an address from a dropped pin works
