var STATUS_SUCCESS = 200;
var STATUS_ERROR = 400;

define([
  'underscore',
  'ko',
  'mage/url',
  'Magento_Checkout/js/model/quote',
],
function(
  _,
  ko,
  mageUrl,
  quote
) {
  'use strict';

  var Model = {
    configuration: ko.observable(null),

    /**
     * Bind the observer to this model.
     */
    rates: null,

    /**
     * The allowed and present shipping methods for which the delivery options would be shown.
     */
    allowedShippingMethods: ko.observableArray([]),

    /**
     * Whether the delivery options will be shown or not.
     */
    hasDeliveryOptions: ko.observable(false),

    /**
     * The country code.
     */
    countryId: ko.observable(null),

    /**
     * Best package type.
     */
    bestPackageType: null,

    /**
     * Initialize by requesting the MyParcel settings configuration from Magento.
     */
    initialize: function() {
      Model.compute = ko.computed(function() {
        var configuration = Model.configuration();
        var rates = Model.rates();

        if (!configuration || !rates.length) {
          return false;
        }

        return {configuration: configuration, rates: rates};
      });

      Model.compute.subscribe(function(a) {
        if (!a) {
          return;
        }

        updateAllowedShippingMethods();
      });

      Model.compute.subscribe(_.debounce(Model.hideShippingMethods));
      Model.allowedShippingMethods.subscribe(_.debounce(updateHasDeliveryOptions));

      Model.countryId(quote.shippingAddress().countryId);
      doRequest(Model.getDeliveryOptionsConfig, {onSuccess: Model.onInitializeSuccess});

      quote.billingAddress.subscribe(function() {
        var shippingAddress = quote.shippingAddress();

        if (shippingAddress.countryId !== Model.countryId()) {
          doRequest(Model.getDeliveryOptionsConfig, {onSuccess: Model.onReFetchDeliveryOptionsConfig});
        }

        Model.countryId(shippingAddress.countryId);
      });
    },

    onReFetchDeliveryOptionsConfig: function(response) {
      var configuration = response[0].data;
      var carrier = Object.keys(configuration.config.carrierSettings)[0];

      doRequest(function() {
        return Model.calculatePackageType(carrier);
      },
      {
        onSuccess: function(response) {
          Model.bestPackageType = response;
          Model.setDeliveryOptionsConfig(configuration);
        },
      });
    },

    /**
     * Fill in the configuration, hide shipping methods and update the allowedShippingMethods array.
     *
     * @param {Array} response - Response from request.
     */
    onInitializeSuccess: function(response) {
      Model.onReFetchDeliveryOptionsConfig(response);
      Model.hideShippingMethods();
    },

    /**
     * Search the rates for the given method code.
     *
     * @param {String} methodCode - Method code to search for.
     *
     * @returns {Object} - The found rate, if any.
     */
    findRateByMethodCode: function(methodCode) {
      return Model.rates().find(function(rate) {
        return rate.method_code === methodCode;
      });
    },

    /**
     * Hide the shipping methods the delivery options should replace.
     */
    hideShippingMethods: function() {
      var rowsToHide = [];

      Model.rates().forEach(function(rate) {
        var rows = Model.getShippingMethodRows(rate.method_code);

        if (!rate.available) {
          return;
        }

        if (rate.method_code.indexOf('myparcel') > -1 && rows.length) {
          Model.getShippingMethodRows(rate.method_code).forEach(function(row) {
            rowsToHide.push(row);
          });
        }
      });

      /**
       * Only hide the allowed shipping method if the delivery options are present.
       */
      if (Model.hasDeliveryOptions()) {
        Model.allowedShippingMethods().forEach(function(shippingMethod) {
          Model.getShippingMethodRows(shippingMethod).forEach(function(row) {
            rowsToHide.push(row);
          });
        });
      }

      if (quote.shippingAddress().countryId === 'NL' || quote.shippingAddress().countryId === 'BE') {
        rowsToHide.forEach(function(row) {
          row.style.display = 'none';
        });
      }
    },

    /**
     * Get shipping method rows by finding the columns with a matching method_code and grabbing their parent.
     *
     * @param {String} shippingMethod - Shipping method to get the row(s) of.
     *
     * @returns {Element[]}
     */
    getShippingMethodRows: function(shippingMethod) {
      var classSelector = '[id^="label_method_' + shippingMethod + '"]';
      var columns = document.querySelectorAll(classSelector);
      var elements = [];

      columns.forEach(function(column) {
        if (column) {
          elements.push(column.parentElement);
        }
      });

      return elements;
    },

    /**
     * Execute the delivery_options request to retrieve the settings object.
     *
     * @returns {XMLHttpRequest}
     */
    getDeliveryOptionsConfig: function() {
      return sendRequest(
        'rest/V1/delivery_options/config',
        'POST',
        JSON.stringify({shippingAddress: [quote.shippingAddress()]})
      );
    },

    /**
     * This method reads the countryId from the checkout form select list country_id, this is Magento standard.
     * There may be checkout plugins without country_id, which we do not support fully
     *
     * @param {String} carrier
     * @returns {XMLHttpRequest}
     */
    calculatePackageType: function(carrier) {
      var list = document.querySelector('[name="country_id"]');
      var countryId = (list) ? list.options[list.selectedIndex].value : Model.countryId();
      return sendRequest(
        'rest/V1/package_type',
        'GET',
        {
          carrier: carrier,
          countryCode: countryId,
        }
      );
    },

    /**
     * Execute the shipping_methods request to convert delivery options to a shipping method id.
     *
     * @param {Object} deliveryOptions - Delivery options data.
     * @param {Object} handlers - Object with handlers to run on different outcomes of the request.
     */
    convertDeliveryOptionsToShippingMethod: function(deliveryOptions, handlers) {
      doRequest(
        function() {
          return sendRequest(
            'rest/V1/shipping_methods',
            'POST',
            JSON.stringify({deliveryOptions: [deliveryOptions]})
          );
        }, handlers
      );
    },

    /**
     * @param {Object} data - Update MyParcelConfig.
     */
    setDeliveryOptionsConfig: function(data) {
      data.config.packageType = Model.bestPackageType;
      window.MyParcelConfig = data;
      Model.configuration(data);
    },

    /**
     * @param {String} carrier
     */
    updatePackageType: function(carrier) {
      doRequest(function() {
        return Model.calculatePackageType(carrier);
      },
      {
        onSuccess: function(response) {
          Model.bestPackageType = response;
        },
      });
    },
  };

  return Model;

  function updateAllowedShippingMethods() {
    /**
     * Filter the allowed shipping methods by checking if they are actually present in the checkout. If not they will
     *  be left out.
     */
    Model.allowedShippingMethods(Model.configuration().methods.filter(function(rate) {
      return !!Model.findRateByMethodCode(rate);
    }));
  }

  function updateHasDeliveryOptions() {
    var isAllowed = false;

    Model.allowedShippingMethods().forEach(function(methodCode) {
      var rate = Model.findRateByMethodCode(methodCode);
      var shippingCountry = quote.shippingAddress().countryId;

      if (rate && rate.available) {
        isAllowed = true;
      }

      /* Only for MyParcelNL */
      if (shippingCountry !== 'NL' && shippingCountry !== 'BE') {
        isAllowed = false;
      }
    });

    Model.hasDeliveryOptions(isAllowed);
    Model.hideShippingMethods();
  }

  /**
   * Request function. Executes a request and given handlers.
   *
   * @param {Function} request - The request to execute.
   * @param {Object} handlers - Object with handlers to run on different outcomes of the request.
   * @property {Function} handlers.onSuccess - Function to run on Success handler.
   * @property {Function} handlers.onError - Function to run on Error handler.
   * @property {Function} handlers.always - Function to always run.
   */
  function doRequest(request, handlers) {
    /**
     * Execute a given handler by name if it exists in handlers.
     *
     * @param {String} handlerName - Name of the handler to check for.
     * @param {*?} params - Parameters to pass to the handler.
     * @returns {*}
     */
    handlers.doHandler = function(handlerName, params) {
      if (handlers.hasOwnProperty(handlerName) && typeof handlers[handlerName] === 'function') {
        return handlers[handlerName](params);
      }
    };

    request().onload = function() {
      var response = JSON.parse(this.response);

      if (this.status >= STATUS_SUCCESS && this.status < STATUS_ERROR) {
        handlers.doHandler('onSuccess', response);
      } else {
        handlers.doHandler('onError', response);
      }

      handlers.doHandler('always', response);
    };
  }

  /**
   * Send a request to given endpoint.
   *
   * @param {String} endpoint - Endpoint to use.
   * @param {String} [method='GET'] - Request method.
   * @param {Object} [options={}] - Request body or params.
   *
   * @returns {XMLHttpRequest}
   */
  function sendRequest(endpoint, method, options) {
    var url = mageUrl.build(endpoint);
    var request = new XMLHttpRequest();
    var query = [];

    method = method || 'GET';
    options = options || {};

    if (method === 'GET') {
      for (var key in options) {
        query.push(key + '=' + encodeURIComponent(options[key]));
      }
    }

    if (query.length) {
      url += '?' + query.join('&');
    }

    request.open(method, url, true);
    request.setRequestHeader('Content-Type', 'application/json');
    request.send(options);

    return request;
  }
});
