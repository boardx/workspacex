# Published expert detail recovery (#5071)

The directory links published organization experts to the detail route, but that component searched only static mock personas. Resolve published ids from the existing authorized catalog API. Show the actual profile and a published-expert label; preserve a return link when unavailable. Static personas retain their simulation label.

Tests: both new detail regressions fail before implementation; detail and quick interview tests pass 5/5 after. Real local UI opens expert-acceptance-5055 and displays its actual synthetic published role/profile and quick link. Screenshot attached. No production data or model fixtures. CI required.
