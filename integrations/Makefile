.DEFAULT_GOAL := package
PYTHON ?= python3

.PHONY: package clean test

package:
	$(PYTHON) build_plugin.py

clean:
	rm -rf -- plugin-dist

test:
	$(PYTHON) -m unittest discover -s tests -v
