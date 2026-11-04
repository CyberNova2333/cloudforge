/* Validate the installed Debian UTF-16 ABI, which upstream's test harness excludes. */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "expat.h"

static void start(void *context, const XML_Char *name, const XML_Char **attributes) {
  (void)attributes;
  int *seen = context;
  assert(sizeof(XML_Char) == 2);
  assert(name[0] == 0x6d4b && name[1] == 0);
  ++*seen;
}

int main(int argc, char **argv) {
  const char data[] = "<\xe6\xb5\x8b/>";
  int seen = 0;
  int checked_width = 0;
  assert(argc == 2);
  assert(strncmp(XML_ExpatVersion(), "expat_", 6) == 0);
  assert(strcmp(XML_ExpatVersion() + 6, argv[1]) == 0);
  const XML_Feature *feature = XML_GetFeatureList();
  for (; feature->feature != XML_FEATURE_END; ++feature) {
    if (feature->feature == XML_FEATURE_SIZEOF_XML_CHAR) {
      assert(feature->value == 2);
      checked_width = 1;
    }
  }
  assert(checked_width);
  XML_Parser parser = XML_ParserCreate(NULL);
  assert(parser != NULL);
  XML_SetUserData(parser, &seen);
  XML_SetStartElementHandler(parser, start);
  assert(XML_Parse(parser, data, (int)strlen(data), XML_TRUE) == XML_STATUS_OK);
  assert(seen == 1);
  XML_ParserFree(parser);
  puts("Installed UTF-16 library preserves its ABI and parses XML successfully");
  return 0;
}
