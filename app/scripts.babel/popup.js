var dataUriToBlob = function (dataURI) {
  // convert base64/URLEncoded data component to raw binary data held in a string
  var byteString;

  if (dataURI.split(',')[0].indexOf('base64') >= 0) {
    byteString = atob(dataURI.split(',')[1]);
  } else {
    byteString = unescape(dataURI.split(',')[1]);
  }

  // write the bytes of the string to a typed array
  var ia = new Uint8Array(byteString.length);

  for (var i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
  }

  return new Blob([ia], {type: 'image/jpeg'});
};

var createImgUrlFromUri = function (uri) {
  var uri = uri || Popup.captureUri;
  var blob = dataUriToBlob(uri);
  return window.URL.createObjectURL(blob);
};

/**
 * Code for the popup UI.
 */
Popup = {

  // Is this an external popup window? (vs. the one from the menu)
  is_external: false,

  // Options loaded when popup opened.
  options: null,

  // Info from page we were triggered from
  page_title: null,
  page_url: null,
  page_selection: null,
  favicon_url: null,
  captureUri: null,

  // State to track so we only log events once.
  has_edited_name: false,
  has_edited_notes: false,
  has_reassigned: false,
  has_used_page_details: false,
  is_first_add: true,

  // Data from API cached for this popup.
  workspaces: null,
  users: null,
  user_id: null,
  projects: null,

  onLoad: function() {
    var me = this;

    me.is_external = ('' + window.location.search).indexOf('external=true') !== -1;

    // Our default error handler.
    Asana.ServerModel.onError = function(response) {
      me.showError(response.errors[0].message);
    };

    // Ah, the joys of asynchronous programming.
    // To initialize, we've got to gather various bits of information.
    // Starting with a reference to the window and tab that were active when
    // the popup was opened ...
    chrome.tabs.query({
      active: true,
      currentWindow: true
    }, function(tabs) {
      var tab = tabs[0];
      // Now load our options ...
      Asana.ServerModel.options(function(options) {
        me.options = options;
        // And ensure the user is logged in ...
        Asana.ServerModel.isLoggedIn(function(is_logged_in) {
          if (is_logged_in) {
            Asana.ServerModel.logEvent({
              name: 'ChromeExtension-Open-Button'
            });

            var sessionOptions = Asana.Options.loadOptionsSession();

            if (sessionOptions.client_projects === null) {
              Asana.ServerModel.projects(function(projects) {
                var sortedClientProjects = projects.sort(function (a, b) {
                  var aLower = a.name.toLowerCase();
                  var bLower = b.name.toLowerCase();
                  return (aLower > bLower) ? 1 : ((bLower > aLower) ? -1 : 0);
                }).filter(function(project) {
                  return project.name.indexOf(' CC') === -1 && project.name.indexOf(' MS') === -1;
                });
                sessionOptions.client_projects = sortedClientProjects;
                Asana.Options.saveSessionOptions(sessionOptions);
                Popup.projects = sortedClientProjects
              });
            } else {
              Popup.projects = sessionOptions.client_projects;
            }

            // Get the selection from the tab that was active
            // when we were opened. So we set up a listener to
            // listen for the selection send event from the content
            // window ...
            var selection = '';
            var listener = function(request, sender, sendResponse) {
              if (request.type === 'selection') {
                chrome.runtime.onMessage.removeListener(listener);
                console.info('Asana popup got selection');
                selection = '\n' + request.value;
              }
            };
            chrome.runtime.onMessage.addListener(listener);
            me.buildCustomFieldsUI();
            me.showAddUi(tab.url, tab.title, '', tab.favIconUrl);
          } else {
            // The user is not even logged in. Prompt them to do so!
            me.showLogin(
                Asana.Options.loginUrl(options),
                Asana.Options.signupUrl(options));
          }
        });
      });
    });

    // Wire up some events to DOM elements on the page.

    $(window).keydown(function(e) {
      // Close the popup if the ESCAPE key is pressed.
      if (e.which === 27) {
        if (me.is_first_add) {
          Asana.ServerModel.logEvent({
            name: 'ChromeExtension-Abort'
          });
        }
        window.close();
      } else if (e.which === 9) {
        // Don't let ourselves TAB to focus the document body, so if we're
        // at the beginning or end of the tab ring, explicitly focus the
        // other end (setting body.tabindex = -1 does not prevent this)
        if (e.shiftKey && document.activeElement === me.firstInput().get(0)) {
          me.lastInput().focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === me.lastInput().get(0)) {
          me.firstInput().focus();
          e.preventDefault();
        }
      }
    });

    // Close if the X is clicked.
    $('.close-x').click(function() {
      if (me.is_first_add) {
        Asana.ServerModel.logEvent({
          name: 'ChromeExtension-Abort'
        });
      }
      window.close();
    });

    $('#bug-title').keyup(function() {
      if (!me.has_edited_name && $('#bug-title').val() !== '') {
        me.has_edited_name = true;
        Asana.ServerModel.logEvent({
          name: 'ChromeExtension-ChangedTaskName'
        });
      }
      me.maybeDisablePageDetailsButton();
    });

    $('#notes_input').keyup(function() {
      if (!me.has_edited_notes && $('#notes_input').val() !== '') {
        me.has_edited_notes= true;
        Asana.ServerModel.logEvent({
          name: 'ChromeExtension-ChangedTaskNotes'
        });
      }
      me.maybeDisablePageDetailsButton();
    });

    $('#add_button').click(function() {
      me.createTask();
      return false;
    });

    $('#add_button').keydown(function(e) {
      if (e.keyCode === 13) {
        me.createTask();
      }
    });

    $('#project_select').change(function () {
      Asana.ServerModel.logEvent({
        name: 'ChromeExtension-ChangedProject'
      });
      me.onProjectChanged();
    });

    $('#info_screenshot_toggle').click(function () {
      $('#bug_info, #bug_screenshot').toggle();
      $(this).text() === 'screenshot' ? $(this).text('info') : $(this).text('screenshot');
    });
  },

  maybeDisablePageDetailsButton: function() {
    if ($('#bug-title').val() !== '' || $('#notes_input').val() !== '') {
      $('#use_page_details').addClass('disabled');
    } else {
      $('#use_page_details').removeClass('disabled');
    }
  },

  setExpandedUi: function(is_expanded) {
    if (this.is_external) {
      window.resizeTo(
          Asana.POPUP_UI_WIDTH,
          (is_expanded ? Asana.POPUP_EXPANDED_UI_HEIGHT : Asana.POPUP_UI_HEIGHT)
              + Asana.CHROME_TITLEBAR_HEIGHT);
    }
  },

  showView: function(name) {
    ['login', 'add', 'loading'].forEach(function(view_name) {
      $('#' + view_name + '_view').css('display', view_name === name ? '' : 'none');
    });
  },

  buildCustomFieldsUI: function() {
    Asana.ServerModel.project(Asana.BUG_TRACKING_PROJECT_ID, function(project) {
      if (project.hasOwnProperty('custom_field_settings')) {
        project.custom_field_settings.forEach(function (custom_field_setting) {
          var field = custom_field_setting.custom_field;
          var $leftColumn = $('<div />', {
            'class': 'left-column',
            'html': '<span class="icon-notes sprite"></span>'
          });
          var $middleColumn = $('<div />', {
            'class': 'middle-column',
            'data-custom-field': '',
            'data-custom-field-type': field.type,
            'data-custom-field-option-id': field.id,
            'html': '<span class="label">' + field.name + ': </span>'
          });
          var handelizedName = field.name.toLowerCase().replace(/\W/g, '-').replace(/-{2,}/, '-');
          var $generatedInput;

          if (field.type === 'enum') {
            var $select = $('<select />', {
              'id': handelizedName + '-input',
              'class': 'select-input'
            });
            field.enum_options.filter(function (option) {
              return option.enabled === true;
            }).forEach(function (option) {
              $('<option />', {
                'value': option.id,
                'text': option.name
              }).appendTo($select);
            });
            $generatedInput = $select.prepend($('<option />', {
              'text': '--',
              'selected': 'selected',
              'disabled': 'disabled',
              'class': 'initial-state',
              'value': ''
            }));
          } else if (field.type === 'number' || field.type === 'text') {
            $generatedInput = $('<input />', {
              'id': handelizedName + '-input',
              'class': 'generic-input',
              'type': field.type,
              'placeholder': field.name
            });
          }

          $middleColumn.append($generatedInput);
          $('<div />', {
            'class': 'input-row ' + handelizedName + '-row'
          }).append($leftColumn).append($middleColumn).appendTo('#bug_info');
        });
      }
    });
  },

  showAddUi: function(url, title, selected_text, favicon_url) {
    var me = this;

    // Store off info from page we got triggered from.
    me.page_url = url;
    me.page_title = title;
    me.page_selection = selected_text;
    me.favicon_url = favicon_url;

    if (Popup.captureUri === null) {
      chrome.tabs.captureVisibleTab(null, {}, function (dataUri) {
        Popup.captureUri = dataUri;
        var imageUrl = createImgUrlFromUri(Popup.captureUri);
        $('.screenshot').attr('src', imageUrl);
      });
    } else {
      var imageUrl = createImgUrlFromUri(Popup.captureUri);
      $('.screenshot').attr('src', imageUrl);
    }



    // Populate workspace data and project selector and select default.
    Asana.ServerModel.me(function(user) {
      me.user_id = user.id;

      // Set initial UI state

      var $project = $('#project')
      var $select = $('#project_select');
      var $selectContainer = $('#project_select_container');
      var pollForProjects = setInterval(function () {
        if (Popup.projects && Popup.projects.length > 1) {
          $select.html('').append('<option selected value="">N/A</option>');
          Popup.projects.forEach(function(project) {
            $select.append('<option value="' + project.id + '">' + project.name + '</option>');
          });
          $project.html($('#project_select option:selected').text());
          clearInterval(pollForProjects);
        } else if (Popup.projects && Popup.projects.length === 1) {
          $project.html(Popup.projects[0].name);
          $selectContainer.hide();
          clearInterval(pollForProjects);
        } else if ((Popup.projects && Popup.projects.length === 1) || (Popup.projects !== null && Popup.projects.constructor !== Array)) {
          $project.html('N/A');
          $selectContainer.hide();
          clearInterval(pollForProjects);
        }
      }, 500);

      me.resetFields();
      me.showView('add');

      var bugTitle = $('#bug-title');
      bugTitle.focus();
      bugTitle.select();

      $('.screenshot').attr('src', Popup.captureUri).show();
    });
  },

  /**
   * @param enabled {Boolean} True if the add button should be clickable.
   */
  setAddEnabled: function(enabled) {
    var me = this;
    var button = $('#add_button');

    if (enabled) {
      // Update appearance and add handlers.
      button.removeClass('is-disabled');
    } else {
      // Update appearance and remove handlers.
      button.addClass('is-disabled');
    }
  },

  showError: function(message) {
    console.log('Error: ' + message);
    $('#error').css('display', 'inline-block');
  },

  hideError: function() {
    $('#error').css('display', 'none');
  },

  /**
   * Clear inputs for new task entry.
   */
  resetFields: function() {
    $('#bug-title, #bug-estimate, #browser-version-input').val('');
    $('.select-input').each(function () {
      this.selectedIndex = '0';
    });
    $('#estimate-enabled').prop('checked', false)
    // $('.screenshot').attr('src', '').hide();
  },

  /**
   * Set the add button as being 'working', waiting for the Asana request
   * to complete.
   */
  setAddWorking: function(working) {
    this.setAddEnabled(!working);
    $('#add_button').find('.button-text').text(
        working ? 'Adding...' : 'Add to Asana');
  },

  /**
   * Update the list of users as a result of setting/changing the workspace.
   */
  onProjectChanged: function() {
    var me = this;
    // Update selected project
    $('#project').html($('#project_select option:selected').text());
    me.setAddEnabled(true);
  },

  /**
   * @param id {Integer}
   * @return {dict} Workspace data for the given workspace.
   */
  workspaceById: function(id) {
    var found = null;
    this.workspaces.forEach(function(w) {
      if (w.id === id) {
        found = w;
      }
    });
    return found;
  },

  /**
   * @return {Integer} ID of the selected workspace.
   */
  selectedWorkspaceId: function() {
    return parseInt($('#workspace_select').val(), 10);
  },

  /**
   * Create a task in asana using the data in the form.
   */
  createTask: function() {
    var me = this;

    // Update UI to reflect attempt to create task.
    console.info('Creating task');
    me.hideError();
    me.setAddWorking(true);

    if (!me.is_first_add) {
      Asana.ServerModel.logEvent({
        name: 'ChromeExtension-CreateTask-MultipleTasks'
      });
    }

    var taskMessage = 'URL: ' + me.page_url + '\n•Steps to reproduce:\n•What you expected to happen:\n•What actually happened: \n•More details:\n\nNote: Before you file a new bug, please check to see if it has already been filed in this project. If it has, heart or comment the existing bug task to indicate that you\'ve experienced the same bug (instead of adding another task).\n\nMake sure it\'s actually a bug and not an enhancement requested by the client.'

    // Gather up custom fields data
    var customFieldsData = {};
    $('[data-custom-field]').each(function () {
      var fieldKey = $(this).data('custom-field-option-id');
      var fieldType = $(this).data('custom-field-type');
      var fieldValue = '';
      if (fieldType === 'enum') {
        fieldValue = parseInt($(this).find('select').val(), 10);
      } else if (fieldType === 'number') {
        fieldValue = parseInt($(this).find('input').val(), 10);
      } else if (fieldType === 'text') {
        fieldValue = $(this).find('input').val();
      }
      customFieldsData[fieldKey] = fieldValue;
    });

    var bugTitle = $('#bug-title').val();
    var projectsArray = [Asana.BUG_TRACKING_PROJECT_ID];

    if (bugTitle.indexOf('BUG:') === -1) {
      bugTitle = 'BUG: ' + bugTitle;
    }

    if ($('#estimate-enabled').is(':checked')) {
      bugTitle = '[' + $('#bug-estimate').val() + '] ' + bugTitle;
    } else {
      bugTitle = '[?] ' + bugTitle;
    }

    if ($('#project_select').val() !== '') {
      projectsArray.push(parseInt($('#project_select').val(), 10));
    }

    Asana.ServerModel.createTask(
        Asana.BVA_WORKSPACE_ID,
        {
          name: bugTitle,
          notes: taskMessage,
          projects: projectsArray,
          custom_fields: customFieldsData
        },
        function(task) {
          me.setAddWorking(false);
          me.showSuccess(task);
          me.resetFields();
          $('#bug-title').focus();

          var blob = dataUriToBlob(Popup.captureUri);

          Asana.ServerModel.uploadAttachment(
            task,
            Popup.captureUri,
            function() {
              console.log('attachment successfully sent.');
            },
            function(err) {
              console.error(err);
            }
          )

        },
        function(response) {
          // Failure. :( Show error, but leave form available for retry.
          Asana.ServerModel.logEvent({
            name: 'ChromeExtension-CreateTask-Failure'
          });
          me.setAddWorking(false);
          me.showError(response.errors[0].message);
        });
  },

  /**
   * Helper to show a success message after a task is added.
   */
  showSuccess: function(task) {
    var me = this;
    Asana.ServerModel.taskViewUrl(task, function(url) {
      var name = task.name.replace(/^\s*/, '').replace(/\s*$/, '');
      var link = $('#new_task_link');
      link.attr('href', url);
      link.text(name !== '' ? name : 'Task');
      link.unbind('click');
      link.click(function() {
        chrome.tabs.create({url: url});
        window.close();
        return false;
      });

      // Reset logging for multi-add
      me.has_edited_name = true;
      me.has_edited_notes = true;
      me.has_reassigned = true;
      me.is_first_add = false;

      $('#success').css('display', 'inline-block');
    });
  },

  /**
   * Show the login page.
   */
  showLogin: function(login_url, signup_url) {
    var me = this;
    $('#login_button').click(function() {
      chrome.tabs.create({url: login_url});
      window.close();
      return false;
    });
    $('#signup_button').click(function() {
      chrome.tabs.create({url: signup_url});
      window.close();
      return false;
    });
    me.showView('login');
  },

  firstInput: function() {
    return $('#project_select');
  },

  lastInput: function() {
    return $('#add_button');
  }
};

$(window).load(function() {
  Popup.onLoad();
});
