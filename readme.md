# Inkstone Web Version

This is a web application version of the [Inkstone project](https://github.com/skishore/inkstone). 

To be honest, I couldn't get the app to work on my phone so I couldn't even test it, so that's when I had the bright idea to port it to the web. 

We also added additional features, namely an FSRS scheduler algorithm.

Inkstone Web Version can work locally cached, and so you can learn Chinese on the go even when disconnected from the internet.

Currently, this project is in Alpha, **PLEASE EXPECT SAVES TO POSSIBLY BECOME BROKEN IN FUTURE/DIFFERENT VERSIONS**. Backwards compatibility is __not to be expected__ until the application is stable.

We hope that you have fun learning Chinese vocabulary with our program!

## Character data generation

Character data comes from Make Me A Hanzi. If there any errors in stroke data,
definitions, etc, please make a pull request on that [Github repo](https://github.com/skishore/makemeahanzi).

Sometimes I may forget to update to update stroke data, in this case, generate them yourself, and then submit a pull request to me, titled "Update of character data"

Download [dictionary.txt](https://raw.githubusercontent.com/skishore/makemeahanzi/refs/heads/master/dictionary.txt) and [graphics.txt](https://raw.githubusercontent.com/skishore/makemeahanzi/refs/heads/master/graphics.txt) and put them somewhere on your machine, then run:

```
python3 tools/build_hanzi_data.py /path/to/dictionary.txt /path/to/graphics.txt data/hanzi.json
```

## Try it out yourself

```
git pull https://github.com/A-Random-Username-4m3/Inkstone-Web.git
cd Inkstone-Web
python -m http.server 8080
```

## Plans/Todo

- Also make a Japanese variant
- Get an instance working somewhere
