// Parallel Coordinates
// Copyright (c) 2012, Kai Chang
// Modified by Fernando Martinez and Jonathan Duncan (First-Rate Programmers, 2021)
// Light Improvements in 2025
// For AMEGroup
// Released under the BSD License: http://opensource.org/licenses/BSD-3-Clause

// Ideas for overlapping

// - Maybe brush and rerender the axis to zoom into the brushed section
// - Add opacity to colors => Opacity darkens colors and makes line thinner
// - regenerate scale when brushing

let width = document.body.clientWidth,
    // heightCoefficient determines screen space the graph will have
    heightCoefficient = .55,
    height = d3.max([document.body.clientHeight * heightCoefficient, 240]);

let m = [120, 40, 70, 40],
    w = width - m[1] - m[3],
    h = height - m[0] - m[2],
    xscale = d3.scale.ordinal().rangePoints([0, w], 1),
    yscale = {},
    ordinal = [],
    dragging = {},
    line = d3.svg.line(),
    //this can control amount of ticks
    axis = d3.svg.axis().orient("left").ticks(1 + height / 50),
    data,
    foreground,
    background,
    highlighted,
    dimensions,
    dimensionsIO,
    legend,
    render_speed = 50,
    brush_count = 0,
    excluded_groups = [],
    tableSelect = [],
    myColor,
    refAxis,
    highlightSelected = false,
    brushing = false,
    outOfSpace,
    labels = ["INPUTS", "OUTPUTS"],
    magnitudes = [],
    inputs = [],
    outputs = [],
    targets = [],
    csvFileName,
    firstOutputPosition,
    lastInputPosition,
    clickedOnBrush = true,
    selected,
    rows,
    loadedData = false,
    expandedMode = false,
    fullScreenMode = false;

//HSL
var colors = {
    "test": [225, 53, 70],
    "background": [225, 5, 80]
};

// handle upload button
function upload_button(el, callback) {
    
    var uploader = document.getElementById(el);
    var reader = new FileReader();

    reader.onload = function (e) {
        var contents = e.target.result;
        callback(contents);
    };

    uploader.addEventListener("change", handleFiles, false);

    function handleFiles() {
        //Validate CSV
        var fileName = uploader.files[0].name;
        if (!(/\.(csv)$/i).test(fileName)) {
            document.getElementById('file-span').innerHTML = fileName + " - Please Upload a CSV";
            alert("The file you are trying to upload is not a .csv file. Please try uploading a .csv file again.");
            return;
        }

        let name = fileName.split(".");
        csvFileName = name[0];
        document.getElementById('file-span').innerHTML = "";
        document.getElementById('file-span').innerHTML = name[0];

        var file = this.files[0];
        reader.readAsText(file);
    };
};

// Scale chart and canvas height
d3.select("#chart")
    .style("height", (h + m[0] + m[2]) + "px")

d3.selectAll("canvas")
    .attr("width", w)
    .attr("height", h)
    .style("padding", m.join("px ") + "px");


// Foreground canvas for primary view
foreground = document.getElementById('foreground').getContext('2d');
foreground.globalCompositeOperation = "destination-over";
foreground.strokeStyle = "rgba(0,100,160,1)";
foreground.lineWidth = 2;

// Highlight canvas for temporary interactions
highlighted = document.getElementById('highlight').getContext('2d');
highlighted.strokeStyle = "rgba(0,100,160,1)";
highlighted.lineWidth = 4;

// Background canvas
background = document.getElementById('background').getContext('2d');
background.strokeStyle = "rgba(85,72,72,0.7)";
background.lineWidth = 1;

// SVG for ticks, labels, and interactions
var svg = d3.select("svg")
    .attr("width", w + m[1] + m[3])
    .attr("height", h + m[0] + m[2])
    .append("svg:g")
    .attr("transform", "translate(" + m[3] + "," + m[0] + ")")

// Append Fonts
var styles = RobotoBold + RobotoRegular + BarlowBold + RobotLight + RobotoMedium;

svg.append('defs')
    .append('style')
    .attr('type', 'text/css')
    .text((styles));

d3.selectAll(".file-upload")
    .style("font-size", "20px")    
    .style('font-family', '"RobotoRegular"')
    .style('color', "#5e676d")         

// Load the data and visualization
function load_dataset(fileData) {

    //Remove Existing Axes
    d3.selectAll(".dimension").remove();

    var raw_data = d3.csv.parse(fileData);

    // Convert quantitative scales to floats
    data = raw_data.map(function (d) {
        for (var k in d) {
            if (!_.isNaN(raw_data[0][k] - 0) && k != 'id') {
                d[k] = parseFloat(d[k]) || 0;
            }
        };
        return d;
    });

    //Get Magnitudes, Input/Outputs and Targets    
    var header = data[0];
    var oldLabels = [];
    magnitudes = [];
    for (var key in header) {

        oldLabels.push(key);
        let res = key.split(":");
        let magnitudeObject = {};

        if (res.length > 0) {
            magnitudeObject.name = res[0];
        }
        if (res.length > 1) {
            magnitudeObject.io = res[1];
        }
        if (res.length > 2) {
            magnitudeObject.value = res[2];
        }
        if (res.length > 3) {
            magnitudeObject.target = res[3];
        } else {
            magnitudeObject.target = null;
        }
        magnitudes.push(magnitudeObject);
    }

    //Create Data with clean key names
    var newData = [];
    for (let e in data) {
        var unsplitted = data[e];

        var data2 = magnitudes.map(function (m, i) {
            let key = oldLabels[i];
            return { labelName: m.name, value: unsplitted[key] }
        })

        let newrow = {};
        data2.map(function (d) { newrow[d.labelName] = d.value; });
        newData.push(newrow);
    }

    data = newData;

    //Scale for the rest of the data
    xscale.domain(dimensions = d3.keys(data[0]).filter(function (k) {            
        if (checkValues(k)) {
            return (true) && (yscale[k] = d3.scaleLinear()
                .domain(d3.extent(data, function (d) { return +d[k]; }))
                .range([h - 2, 2]));
        }
        else {
            return (true) && (yscale[k] = d3.scale.ordinal()
                .domain(data.map(function (d) { ordinal.push(k); return d[k]; }))
                .rangePoints([h, 0], .1));
        }
    }));   

    //Group for Inputs and Outputs
    var columnKeys = Object.keys(data[0]);

    inputs = [];
    outputs = [];
    columnKeys.map(function (d) {
        let obj = magnitudes.find(m => m.name === d);

        if (obj.io.toLowerCase() === "input") inputs.push(d);
        else if (obj.io.toLowerCase() === "output") outputs.push(d);
    });

    //Error if no IO
    if (inputs.length === 0) displayErrorMsgOnLoad("Inputs");
    if (outputs.length === 0) displayErrorMsgOnLoad("Outputs");
    if (outputs.length === 0 || inputs.length === 0) return;

    //Get Targets Axes Names
    targets = magnitudes.filter(x => x.target !== null);

    // Add a group element for each dimension.
    var g = svg.selectAll(".dimension")
        .data(dimensions)
        .enter().append("svg:g")
        .attr("class", function (d) { return "dimension " + d.replace(/ /g, "_") })
        .attr("transform", function (d) { return "translate(" + xscale(d) + ")"; })
        .call(d3.behavior.drag()
            .on("dragstart", function (d) {              

                if (!brushing && !clickedOnBrush) {
                    dragging[d] = this.__origin__ = xscale(d);
                    this.__dragged__ = false;
                }
            })
            .on("drag", function (d) {
                if (!brushing && !clickedOnBrush) {
                    dragging[d] = Math.min(w, Math.max(0, this.__origin__ += d3.event.dx));
                    //Cannot drag Output to Input
                    if (magnitudes.find(x => x.name === d).io.toLowerCase() === "input") {
                        outOfSpace = position(d) >= firstOutputPosition;
                    }
                    else {
                        outOfSpace = position(d) <= lastInputPosition;
                    }

                    if (!outOfSpace) {
                        dimensions.sort(function (a, b) {
                            return position(a) - position(b);
                        });
                        reorderIOTargetArrays();                       
                    }

                    xscale.domain(dimensions);
                    g.attr("transform", function (d) { return "translate(" + position(d) + ")"; });
                    brush_count++;
                    this.__dragged__ = true;

                    // Feedback for axis deletion if dropped
                    if (dragging[d] < 12 || dragging[d] > w - 12) {
                        d3.select(this).select(".background").style("fill", "#b00");
                    } else {
                        d3.select(this).select(".background").style("fill", null);
                    }
                }
            })
            .on("dragend", function (d) {
                if (!brushing && !clickedOnBrush) {
                    if (!this.__dragged__) {
                        // no movement, invert axis                      
                    } else {
                        // reorder axes
                        d3.select(this).transition().attr("transform", "translate(" + xscale(d) + ")");
                        var extent = yscale[d].brush.extent();
                    }

                     //Check if last Input before removing
                    let lastIO;
                    let group;
                    if (inputs.includes(d)) {
                        if (inputs.length === 1) {
                            lastIO = true;
                            group = "Inputs";
                        } else lastIO = false;
                    }
                    else {
                        if (outputs.length === 1) {
                            lastIO = true;
                            group = "Outputs";
                        }
                        else lastIO = false;
                    }

                    // remove axis if dragged all the way left & other
                    if ((dragging[d] < 12 || dragging[d] > w - 12) && dimensions.length > 2 && !lastIO) {
                        remove_axis(d, g);

                        //Inputs, Outputs, Targets
                        removeFromArrays(d);
                    }
                    else if (lastIO) displayErrorMsgOnDelete(group);

                    // TODO required to avoid a bug
                    xscale.domain(dimensions);
                    update_ticks(d, extent);

                    // rerender
                    d3.select("#foreground").style("opacity", null);
                    brush();

                    //Background Lines
                    paths(data, background, brush_count, true);

                    //Input/Output Label
                    drawLabels();

                    //Remove existing Boxes
                    d3.selectAll(".box").remove();
                    drawBoxes();

                    delete this.__dragged__;
                    delete this.__origin__;
                    delete dragging[d];
                }
            })) 

    // Add an axis and title.
    g.append("svg:g")
        .attr("class", "axis fill4")
        .attr("transform", "translate(0,0)")
        .each(function (d) {
            if (_.isNumber(data[0][d])) {

                let val = [];
                data.map(function (e) {
                    val.push(e[d]);
                });
                let minAndMax = d3.extent(val);

                let ticks = getTicks(minAndMax[0], minAndMax[1], 8);

                // Add Targets to ticks
                const target = targets.find(target => target.name === d);
                if(target) {
                    ticks.push(+target.target);
                }
                
                d3.select(this).call(axis.scale(yscale[d]).tickValues(ticks).tickPadding([15]));                
            }
            else {
                axis = d3.svg.axis().orient("left").ticks(1 + height / 50);  
                d3.select(this).call(axis.scale(yscale[d]).tickPadding([15]));
            }
        })
        .style("font-size", "18px")        
        .style('font-family', '"RobotoBold"')
        .style('color', "#4e4f4f")
        .append("svg:text")
        .attr("text-anchor", "middle")
        .attr("class", "axis-label")
        //Change Label Spacing.
        .attr("y", -50)
        .attr("x", 0)
        .text(String)
        .style("cursor", "move")
        .on("click", function (d) {           
            refAxis = d;
            brush();
        })
        .append("title")
        .text("Click to change color. Drag to reorder");

    styleTicks(g);
    styleTargets(g);
    addExtraLabels(g);   
    setupBrushes(g);    // Add and store a brush for each axis.
    tableSelect = []; //In case new file is loaded, this resets selection
    brush(); // Render full foreground
    paths(data, background, brush_count, true); //Background Lines
    drawLabels(); //Input/Output Labels
    setupTable(selected, data);   
    d3.selectAll(".box").remove(); //Remove existing Boxes
    drawBoxes();
};

const styleTicks = (group) => {
    group.selectAll(".tick")
        .style("font-size", "17px")     
        .style('font-family', '"RobotoMedium"')
        .style('color', "#58595b");
};

const addExtraLabels = (group) => {
    //Measure Magnitudes
    group.append("svg:g")
        .append("text")
        .attr("text-anchor", "middle")
        .style("font-size", "17px")      
        .style('font-family', '"RobotoRegular"')
        .style('color', "#969696")
        .attr('class', 'magnitude font-RR14 fill7')
        .attr('y', -30)
        .attr('x', 0)
        .text((d) => {
            let obj = magnitudes.find(m => m.name === d);
            return obj.value;
        })        
};

const styleTargets = (group) => {
    const ticks = group.selectAll(".tick");
    ticks.forEach((scale) => {        
        const scaleName = scale.parentNode.classList[1];
        const target = targets.find(target => 
            target.name.replace(' ', '_') === scaleName
        );

        if(target ) {
            const tickIndex = scale.findIndex(tick => 
                +tick.children[1].innerHTML === +target.target
            );           

            if(tickIndex >= 0) {   
                const tick = scale[tickIndex];             
                tick.removeChild(tick.children[1]);
                tick.children[0].setAttribute('x2', '-20');
                tick.children[0].setAttribute('x1', '20');               
                tick.children[0].style.strokeWidth = 4;
                tick.children[0].style.stroke = '#a71717';
            }            
        }
    });
};

// copy one canvas to another, grayscale
function gray_copy(source, target) {
    var pixels = source.getImageData(0, 0, w, h);
    target.putImageData(grayscale(pixels), 0, 0);
}

// http://www.html5rocks.com/en/tutorials/canvas/imagefilters/
function grayscale(pixels, args) {
    var d = pixels.data;
    for (var i = 0; i < d.length; i += 4) {
        var r = d[i];
        var g = d[i + 1];
        var b = d[i + 2];
        // CIE luminance for the RGB
        // The human eye is bad at seeing red and blue, so we de-emphasize them.
        var v = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        d[i] = d[i + 1] = d[i + 2] = v
    }
    return pixels;
};

// render polylines i to i+render_speed 
function render_range(selection, i, max, opacity, ctx) {
    let isForeground = ctx === foreground;
    selection.slice(i, max).forEach(function (d) {
        let pColor;
        if (isForeground) pColor = myColor(d[refAxis]);
        else pColor = color("background", 0.4);
        console.log(d, 'd');
        path(d, ctx, pColor);
    });
};


// simple data table
function data_table(sample) {
    // sort by first column
    var sample = sample.sort(function (a, b) {
        var col = d3.keys(a)[0];
        return a[col] < b[col] ? -1 : 1;
    });

    var table = d3.select("#food-list")
        .html("")
        .selectAll(".row")
        .data(sample)
        .enter().append("div")
        .on("mouseover", highlight)
        .on("mouseout", unhighlight);

    table
        .append("span")
        .attr("class", "color-block")
        .style("background", function (d) { return color("test", 0.85) })

    table
        .append("span")
        .text(function (d) { return d.name; })
}

// Adjusts rendering speed 
function optimize(timer) {
    var delta = (new Date()).getTime() - timer;
    render_speed = Math.max(Math.ceil(render_speed * 30 / delta), 8);
    render_speed = Math.min(render_speed, 300);
    return (new Date()).getTime();
}

// Feedback on rendering progress
function render_stats(i, n, render_speed) {
    d3.select("#rendered-count").text(i);
    d3.select("#rendered-bar")
        .style("width", (100 * i / n) + "%");
    d3.select("#render-speed").text(render_speed);
}

// Feedback on selection
function selection_stats(opacity, n, total) {
    d3.select("#data-count").text(total);
    d3.select("#selected-count").text(n);
    d3.select("#selected-bar").style("width", (100 * n / total) + "%");
    d3.select("#opacity").text(("" + (opacity * 100)).slice(0, 4) + "%");
}

// Highlight single polyline
function highlight(d) {
    d3.select("#foreground").style("opacity", "0.25");
    d3.selectAll(".row").style("opacity", function (p) { return (d.group == p) ? null : "0.3" });
    path(d, highlighted, color(d.group, 1));
}

// Remove highlight
function unhighlight() {
    d3.select("#foreground").style("opacity", null);
    d3.selectAll(".row").style("opacity", null);
    highlighted.clearRect(0, 0, w, h);
}

function invert_axis(d) {
    // save extent before inverting
    if (!yscale[d].brush.empty()) {
        var extent = yscale[d].brush.extent();
    }
    if (yscale[d].inverted == true) {
        if (ordinal.includes(d)) yscale[d].rangePoints([h, 0], .1);
        else yscale[d].range([h -2, 2]);

        d3.selectAll('.label')
            .filter(function (p) { return p == d; })
            .style("text-decoration", null);
        yscale[d].inverted = false;
    } else {
        if (ordinal.includes(d)) yscale[d].rangePoints([0, h], .1);
        else yscale[d].range([2, h - 2]);
        d3.selectAll('.label')
            .filter(function (p) { return p == d; })
            .style("text-decoration", "underline");
        yscale[d].inverted = true;
    }
    return extent;
}

// Draw a single polyline
/*
function path(d, ctx, color) {
  if (color) ctx.strokeStyle = color;
  var x = xscale(0)-15;
      y = yscale[dimensions[0]](d[dimensions[0]]);   // left edge
  ctx.beginPath();
  ctx.moveTo(x,y);
  dimensions.map(function(p,i) {
    x = xscale(p),
    y = yscale[p](d[p]);
    ctx.lineTo(x, y);
  });
  ctx.lineTo(x+15, y);                               // right edge
  ctx.stroke();
}
*/

function path(d, ctx, color) {
    
    if (color) ctx.strokeStyle = color;
    ctx.beginPath();
    var x0 = xscale(dimensions[0]),
        y0 = yscale[dimensions[0]](d[dimensions[0]]);   // left edge

    ctx.moveTo(x0, y0);
    dimensions.map(function (p, i) {
        var x = xscale(p),
            y = yscale[p](d[p]);
        var cp1x = x - 0.5 * (x - x0);
        var cp1y = y0;
        var cp2x = x - 0.5 * (x - x0);
        var cp2y = y;
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
        x0 = x;
        y0 = y;
    });
    ctx.lineTo(x0, y0);                               // right edge
    ctx.stroke();
};

function color(d, a) {
    var c = colors[d];
    return ["hsla(", c[0], ",", c[1], "%,", c[2], "%,", a, ")"].join("");
}

function position(d) {
    var v = dragging[d];
    return v == null ? xscale(d) : v;
}

// Handles a brush event, toggling the display of foreground lines.
// TODO refactor
function brush() {

    lastInputPosition = xscale(inputs[inputs.length - 1]);

    //Line Coloring   
    //Reference Axis for coloring order
    refAxisValues = [];
    if (!refAxis) {
        refAxis = dimensions[dimensions.length - 1];
    }

    data.map(function (d) {
        refAxisValues.push(d[refAxis]);
    });
   
    refAxisValues = _.uniq(refAxisValues);
    let colorArray = getColorArray(refAxisValues);

    //Scale if numerical or ordinal
    if (_.isNumber(refAxisValues[0])) {        
       
        //Get Range
        let min = Math.min(...refAxisValues),
            max = Math.max(...refAxisValues);     
        
        //Scale Colors
        x0 = d3.scaleQuantize()
            .domain([max, min])
            .range(colorArray);

        myColor = d3.scaleSequential().domain([max, min])
            .interpolator(d3.interpolateRgbBasis(x0.range()));
    }
    else {
        refAxisValues.sort();

        myColor = d3.scaleOrdinal().domain(refAxisValues)
            .range(colorArray);
    }
    
    brush_count++;
    var actives = dimensions.filter(function (p) {
        let name = p.replace(/ /g, "_");
        let ext = d3.selectAll("." + name + " .extent")   

        //Fix in case Brushes were removed
        let isBrushed = false;
        if (ext[0].length > 0) {
            isBrushed = ext[0][0].attributes.height.value > 0
        }

        return !yscale[p].brush.empty() && isBrushed;
    }),
    extents = actives.map(function (p) { return yscale[p].brush.extent(); });        

    // hack to hide ticks beyond extent
    var b = d3.selectAll('.dimension')[0]
        .forEach(function (element, i) {
            var dimension = d3.select(element).data()[0];
            if (_.include(actives, dimension)) {
                var extentArr = extents[actives.indexOf(dimension)];
                var extent = [];

                extentArr.map(function (a) {
                    a.map(function (b) {
                        extent.push(b);
                    })
                });
            } else {
                d3.select(element)
                    .selectAll('text')
                    .style('font-size', null)
                    .style('font-weight', null)
                    .style('display', null);
            }
            d3.select(element)
                .selectAll('.label')
                .style('display', null);
        });

    // bold dimensions with label
    d3.selectAll('.label')
        .style("font-weight", function (dimension) {
            if (_.include(actives, dimension)) return "bold";
            return null;
        });

    // Get lines within extents
    selected = [];
    data
        .filter(function (d) {
            return !_.contains(excluded_groups, d.group);
        })
        .map(function (d) {
            return actives.every(function (p, i) {
                return extents[i].some(function (e) {

                    if (_.isNumber(d[p])) return e[0] <= d[p] && d[p] <= e[1];
                    else return e[0] <= yscale[p](d[p]) && yscale[p](d[p]) <= e[1];                                   
                })
            }) ? selected.push(d) : null;
        });    

    //Check if there any rects/extents in Axis
    var activeBrushes;
    var extentRects = d3.selectAll(".extent");  
    var activeBrushes = extentRects[0].some(function (d) {
        return d.attributes.height.value > 0;
    });

    if (!activeBrushes) {
        selected = data;
        highlightSelected = false;
        brushing = false;
    }
    else {
        highlightSelected = true;
        brushing = true;
    }

    //Remove Brushes when table Selection
    let currentBrushes = d3.selectAll(".brush");   

    //Check tableSelections
    if (tableSelect.length > 0) {
        highlightSelected = true;
        if (activeBrushes) {
            selected.map(function (d) {
                tableSelect.push(d);
            });
            resetBrushes();
        }
        selected = tableSelect;
        currentBrushes.remove();

    } else if (currentBrushes[0].length === 0) {
        setupBrushes();
    }    

    // Render selected lines
    paths(selected, foreground, brush_count, true);

    if (brush_count > 1) {
        updateTable();
    }    

    loadedData = true;
}

// render a set of polylines on a canvas
function paths(selected, ctx, count) {
    var n = selected.length,
        i = 0,
        opacity = d3.min([2 / Math.pow(n, 0.3), 1]),
        timer = (new Date()).getTime();

    selection_stats(opacity, n, data.length);
    shuffled_data = _.shuffle(selected);
    
    data_table(shuffled_data.slice(0, 25));
    ctx.clearRect(0, 0, w + 1, h + 1);
  
    // render all lines until finished or a new brush event
    function animloop() {
        if (i >= n || count < brush_count) return true;
        var max = d3.min([i + render_speed, n]);
        render_range(shuffled_data, i, max, opacity, ctx);
        render_stats(max, n, render_speed);
        i = max;
        timer = optimize(timer);  // adjusts render_speed
    };

    d3.timer(animloop);
}


// transition ticks for reordering, rescaling and inverting
function update_ticks(d, extent) {

    resetBrushes();
       
    // update axes
    d3.selectAll(".axis")
        .each(function (d, i) {
            // hide lines for better performance
            d3.select(this).selectAll('line').style("display", "none");

            // transition axis numbers
            if (_.isNumber(data[0][d])) {

                let val = [];
                data.map(function (e) {
                    val.push(e[d]);
                });
                let minAndMax = d3.extent(val);
                let ticks = getTicks(minAndMax[0], minAndMax[1], 8);

                // Add Targets to ticks
                const target = targets.find(target => target.name === d);
                if(target) {
                    ticks.push(+target.target);
                }

                d3.select(this)
                    .transition()
                    .duration(720)
                    .call(axis.scale(yscale[d])
                        .tickValues(ticks).tickPadding([15]));
            }
            else {
                axis = d3.svg.axis().orient("left").ticks(1 + height / 50); 
                d3.select(this)
                    .transition()
                    .duration(720)
                    .call(axis.scale(yscale[d])
                        .ticks(1 + height / 50).tickPadding([15]));
            }           
            
            // bring lines back
            d3.select(this).selectAll('line').transition().delay(800).style("display", null);

            d3.select(this)
                .selectAll('text')
                .style('font-weight', null)
                .style('font-size', null)
                .style('display', null);
        });   

    brush_count++;
    brush();

    //Background Lines
    setTimeout(function () { paths(data, background, brush_count, true) }, 1000);     
}

// Rescale to new dataset domain
function rescale() {
    // reset yscales, preserving inverted state
    dimensions.forEach(function (d, i) {
        if (yscale[d].inverted) {
            yscale[d] = d3.scale.linear()
                .domain(d3.extent(data, function (p) { return +p[d]; }))
                .range([0, h], .1);
            yscale[d].inverted = true;
        } else {
            yscale[d] = d3.scale.linear()
                .domain(d3.extent(data, function (p) { return +p[d]; }))
                .range([h, 0], .1);
        }
    });

    update_ticks();

    // Render selected data
    paths(data, foreground, brush_count);
}

// Get polylines within extents
function actives() {
    var actives = dimensions.filter(function (p) { return !yscale[p].brush.empty(); }),
        extents = actives.map(function (p) { return yscale[p].brush.extent(); });

    // filter extents and excluded groups
    var selected = [];
    data
        .filter(function (d) {
            return !_.contains(excluded_groups, d.group);
        })
        .map(function (d) {
            return actives.every(function (p, i) {
                return extents[i][0] <= d[p] && d[p] <= extents[i][1];
            }) ? selected.push(d) : null;
        });

    // free text search
    var query = d3.select("#search")[0][0].value;
    if (query > 0) {
        selected = search(selected, query);
    }

    return selected;
}

// Export data
function export_csv() {
    var keys = d3.keys(data[0]);
    var rows = actives().map(function (row) {
        return keys.map(function (k) { return row[k]; })
    });
    var csv = d3.csv.format([keys].concat(rows)).replace(/\n/g, "<br/>\n");
    var styles = "<style>body { font-family: sans-serif; font-size: 12px; }</style>";
    window.open("text/csv").document.write(styles + csv);
}

// Rerender chart
const renderResize = () => {
    let axes = d3.selectAll(".dimension");
    
    if (axes[0].length > 1) {
        width = document.body.clientWidth,
            height = d3.max([document.body.clientHeight * heightCoefficient, 240]);

        w = width - m[1] - m[3],
            h = height - m[0] - m[2];

        d3.select("#chart")
            .style("height", (h + m[0] + m[2]) + "px")

        d3.selectAll("canvas")
            .attr("width", w)
            .attr("height", h + 2)
            .style("padding", m.join("px ") + "px");

        d3.select("svg")
            .attr("width", w + m[1] + m[3])
            .attr("height", h + m[0] + m[2])
            .select("g")
            .attr("transform", "translate(" + m[3] + "," + m[0] + ")");     
       
        xscale = d3.scale.ordinal().rangePoints([0, w], 1).domain(dimensions);
        dimensions.forEach(function (d) {            
            if (_.isNumber(data[0][d])) yscale[d].range([h - 2, 2]);
            else yscale[d].rangePoints([h, 0], .1);               
        });  

        d3.selectAll(".dimension")
            .attr("transform", function (d) { return "translate(" + xscale(d) + ")"; })

        // update brush placement
        updateBrushes();

        brush_count++;

        // update axis placement      
            d3.selectAll(".axis")
                .each(function (d) {                    
                    if (_.isNumber(data[0][d])) {
                        let val = [];
                        data.map(function (e) {
                            val.push(e[d]);
                        });
                        let minAndMax = d3.extent(val);
                        let ticks = getTicks(minAndMax[0], minAndMax[1], 8);

                        // Add Targets to ticks
                        const target = targets.find(target => target.name === d);
                        if(target) {
                            ticks.push(+target.target);
                        }

                        d3.select(this).call(axis.scale(yscale[d]).tickValues(ticks).tickPadding([15]));
                    }
                    else {
                        axis = d3.svg.axis().orient("left").ticks(1 + height / 50);
                        d3.select(this).call(axis.scale(yscale[d]).ticks(1 + height / 50).tickPadding([15]));
                    }
                });           

        setupTable(selected, data);        

        // render data
        brush();

        //Background Lines
        paths(data, background, brush_count, true);

        //Input/Output Labels
        drawLabels();

        //Remove existing Boxes
        d3.selectAll(".box").remove();
        drawBoxes();

        //Tick style font
        d3.selectAll(".tick")
            .style("font-size", "17px")
            .style('font-family', '"RobotoMedium"')
            .style('color', "#58595b")
    }    
};

// scale to window size
window.onresize = () => {
    renderResize();    
};

// Remove all but selected from the dataset
function keep_data() {
    new_data = actives();
    if (new_data.length == 0) {
        alert("I don't mean to be rude, but I can't let you remove all the data.\n\nTry removing some brushes to get your data back. Then click 'Keep' when you've selected data you want to look closer at.");
        return false;
    }
    data = new_data;
    rescale();
}

// Exclude selected from the dataset
function exclude_data() {
    new_data = _.difference(data, actives());
    if (new_data.length == 0) {
        alert("I don't mean to be rude, but I can't let you remove all the data.\n\nTry selecting just a few data points then clicking 'Exclude'.");
        return false;
    }
    data = new_data;
    rescale();
}

function remove_axis(d, g) {
    dimensions = _.difference(dimensions, [d]);
    xscale.domain(dimensions);
    g.attr("transform", function (p) { return "translate(" + position(p) + ")"; });
    g.filter(function (p) { return p == d; }).remove();
    update_ticks();
}

function containsObject(obj, list) {
    var i;
    for (i = 0; i < list.length; i++) {
        if (list[i] === obj) {
            return true;
        }
    }
    return false;
}

function setupTable(selected, data) {   

    //Remove Existing Table
    d3.select("#table div").remove();

    if(expandedMode) {
        return;
    }

    //Table   
    var column_names = Object.keys(data[0]);

    //Record sort clicks
    var headerClicks = {};
    column_names.map(function (a) { headerClicks[a] = 0; });

    // draw the table
    d3.selectAll("#table").append("div")
        .attr("id", "container")

    //Calc Remaining Space in Body
    let el = document.getElementsByClassName("mainDiv");

    let elHeight = 0;
    for (let item of el) {
        let h = item.offsetHeight;
        elHeight += h;
    }

    let tHeight = document.body.clientHeight - elHeight;

    d3.selectAll("#container").append("div")
        .attr("id", "FilterableTable")
        .style("max-height", tHeight - 50 + "px");

    var table = d3.selectAll("#FilterableTable").append("table");
    table.append("thead").append("tr");

    var headers = table.selectAll("tr").selectAll("th")
        .data(column_names)
        .enter()
        .append("th")     
        .style("font-size", "18px")
        .style('font-family', '"RobotoBold"')
        .style('color', "#4e4f4f")
        .attr("class", "mozFontFix")

        .text(function (d) { return d; });    

    // draw table body with rows
    var tableBody = table.append("tbody")

    // data bind
    rows = tableBody.selectAll("tr")
        .data(data);

    // enter the rows
    rows.enter()
        .append("tr")
        .attr("class", function (d) {
            if (containsObject(d, selected) && highlightSelected) return "selected";
            else return "notSelected";
        })

    // enter td's in each row
    row_entries = rows.selectAll("td")
        .data(function (d) {
            var arr = [];
            for (var k in d) {
                if (d.hasOwnProperty(k)) {
                    arr.push(d[k]);
                }
            }
            return arr;
        })
        .enter()
        .append("td")
        .text(function (d) { return d; })
        .style("font-size", "18px")
        .style('font-family', '"RobotoLight"')
        .style('color', "#4e4f4f");    

    rows
        .on("click", function (d) {
            if (containsObject(d, tableSelect)) {
                //deselect
                let index = tableSelect.indexOf(d);
                tableSelect.splice(index, 1);
                brush();
            }
            else {
                //select     
                tableSelect.push(d);
                highlightSelected = true;
                brush();
            }
        });

    /**  sort functionality **/
    headers
        .on("click", function (d) {
            var extent;
            if (!(_.isNumber(data[0][d]))) {
                headerClicks[d]++;
                if (headerClicks[d] % 2 != 0) {
                    // sort descending: alphabetically
                    if (!(headerClicks[d] === 1)) {
                        extent = invert_axis(d);
                        
                    }

                    rows.sort(function (a, b) {
                        if (a[d].toUpperCase() < b[d].toUpperCase()) {
                            return 1;
                        } else if (a[d].toUpperCase() > b[d].toUpperCase()) {
                            return -1;
                        } else {
                            return 0;
                        }
                    });
                }
                else if (headerClicks[d] % 2 == 0) {
                    // sort ascending: alphabetically
                    if (!(headerClicks[d] === 1)) {
                        extent = invert_axis(d);
                    }

                    rows.sort(
                        function (a, b) {
                            if (a[d].toUpperCase() < b[d].toUpperCase()) {
                                return -1;
                            }
                            else if (a[d].toUpperCase() > b[d].toUpperCase()) {
                                return 1;
                            }
                            else {
                                return 0;
                            }
                        });
                }

            }
            else {
                headerClicks[d]++;
                if (headerClicks[d] % 2 != 0) {
                    // sort descending: numerically
                    if (!(headerClicks[d] === 1)) {
                        extent = invert_axis(d);
                    }

                    rows.sort(function (a, b) {
                        if (+a[d] < +b[d]) {
                            return 1;
                        } else if (+a[d] > +b[d]) {
                            return -1;
                        } else {
                            return 0;
                        }
                    });
                }
                else if (headerClicks[d] % 2 == 0) {
                    if (!(headerClicks[d] === 1)) {
                        extent = invert_axis(d);
                    }

                    rows.sort(function (a, b) {
                        if (+a[d] < +b[d]) {
                            return -1;
                        } else if (+a[d] > +b[d]) {
                            return 1;
                        } else {
                            return 0;
                        }
                    });
                }
            }

            if (!(headerClicks[d] === 1)) {
                update_ticks(d, extent);
            }
        });
}

function updateTable() {
    rows.sort(function (a, b) {
        if (containsObject(a, selected) && !(containsObject(b, selected))) { return -1 }
        else if (containsObject(a, selected) && containsObject(b, selected)) { return 0; }
        else if (!(containsObject(a, selected)) && (containsObject(b, selected))) { return 1; }
    });

    rows
        .attr("class", function (d) {
            if (containsObject(d, selected) && highlightSelected) return "selected";
            else return "notSelected";
        })
}

function drawBoxes() {    
  
    let firstOutputPosition = xscale(outputs[0]);
    let lastOutputPosition = xscale(outputs[outputs.length - 1]);   

    let firstInputPosition = xscale(inputs[0]);
    let lastInputPosition = xscale(inputs[inputs.length - 1]);
       
    var spaceBetweenAxes = 1;   
    if (!(dimensions.length === 1)) spaceBetweenAxes = xscale(dimensions[1]) - xscale(dimensions[0]);     
   
    //Extra Space Between last Axis and svg end.
    let extraSpace = xscale(dimensions[0]);
  
    let wInputBox = lastInputPosition - firstInputPosition + (spaceBetweenAxes * 0.47) + extraSpace + m[1];  
    
    let xOutputRect = firstOutputPosition + m[1] - (spaceBetweenAxes * 0.47);
    let wOutputBox = lastOutputPosition - firstOutputPosition + (spaceBetweenAxes * 0.47) + extraSpace + xOutputRect;   
   
    //Inputs Box
    if (!inputs.length <= 0) drawRect(m[1], wInputBox, height);    
   
    //Outputs Box
    if (!outputs.length <= 0) drawRect(xOutputRect, wOutputBox, height);   
}

function resizeExtent(selection) {
    selection
        .attr("x", -19)
        .attr("width", 37);
}

function drawRect(x, rectWidth, rectHeight) {
   
    //left line
    d3.select("svg")
        .append("line")
        .attr("class", "box")
        .attr("x1", x )
        .attr("y1", 10)
        .attr("x2", x)
        .attr("y2", rectHeight - 5)       
        .attr("stroke", "rgba(173, 173, 173, 0.5)")
        .attr("stroke-width", "1")      
        .attr("filter", "url(#dropshadow)")

    //Superior Line
    d3.select("svg")
        .append("line")
        .attr("class", "box")
        .attr("x1", x)
        .attr("y1", 10)
        .attr("x2", rectWidth)
        .attr("y2", 10)
        .attr("stroke", "rgba(173, 173, 173, 0.5)")
        .attr("stroke-width", "1")
        .attr("filter", "url(#dropshadow2)")

    //Right Line
    d3.select("svg")
        .append("line")
        .attr("class", "box")
        .attr("x1", rectWidth)
        .attr("y1", 10)
        .attr("x2", rectWidth)
        .attr("y2", rectHeight - 5)
        .attr("stroke", "rgba(173, 173, 173, 0.5)")
        .attr("stroke-width", "1")
        .attr("filter", "url(#dropshadow2)")

    //Inferior Line
    d3.select("svg")
        .append("line")
        .attr("class", "box")
        .attr("x1", x)
        .attr("y1", rectHeight - 5)
        .attr("x2", rectWidth)
        .attr("y2", rectHeight - 5 )
        .attr("stroke", "rgba(173, 173, 173, 0.5)")
        .attr("stroke-width", "1")
        .attr("filter", "url(#dropshadow)")    
}

function drawLabels() {
    
    let inputLabelPosition;
    if (!inputs.length <= 0) inputLabelPosition = xscale(inputs[inputs.length - 1]) - ((xscale(inputs[inputs.length - 1]) - xscale(inputs[0])) / 2);
    else inputLabelPosition = width * 0.3;

    let outputLabelPosition
    if (!outputs.length <= 0) outputLabelPosition = xscale(outputs[outputs.length - 1]) - ((xscale(outputs[outputs.length - 1]) - xscale(outputs[0])) / 2);
    else outputLabelPosition = width * 0.90;

    // Add a Label for each input output.  
    d3.selectAll(".dimensionIO").remove();

    svg.selectAll(".dimensionIO")
        .data(labels)
        .enter().append("svg:g")
        .attr("class", "dimensionIO fill3")
        .attr("transform", function (d, i) {
            if (d === "INPUTS") return "translate( " + inputLabelPosition + " )";
            else if (d === "OUTPUTS") return "translate( " + outputLabelPosition + " )";          
        })
        .append("text")
        .attr("text-anchor", "middle")      
        .style("font-size", "20px")        
        .style('font-family', '"BarlowBold"')
        .style('color', "#4e4f4f")
        .style('letter-spacing', "2px")
        .attr("class", "font-BB17")
        .attr('y', -80)
        .attr('x', 0)
        .text(function (d) {
            if (d === "INPUTS" && !inputs.length <= 0) return "INPUTS";
            else if (d === "OUTPUTS" && !outputs.length <= 0) return "OUTPUTS";
            else return " ";
        });
}

function removeFromArrays(d) {
    if (containsObject(d, inputs)) {
        let i = inputs.indexOf(d);
        inputs.splice(i, 1);
    }
    else if (containsObject(d, outputs)) {
        let i = outputs.indexOf(d);
        outputs.splice(i, 1);
    }

    let idx = targets.findIndex(n => n.name === d);
    targets.splice(idx, 1);
}

// Expand/Collapse/Fullscreen

d3.select('#expand-button').on('click', () => {     
    expandedMode = true;
    heightCoefficient = 0.85;
    renderResize();
    d3.select('#expand-button').style('display', 'none');
    d3.select('#collapse-button').style('display', 'inline-flex');
});

d3.select('#collapse-button').on('click', () => {    
    expandedMode = false;
    heightCoefficient = 0.55;
    renderResize();
    d3.select('#collapse-button').style('display', 'none');
    d3.select('#expand-button').style('display', 'inline-flex');
});

d3.select('#full-screen-button').on('click', () => {    
    let elem = document.documentElement;
    fullScreenMode = !fullScreenMode;

    if (fullScreenMode) {
        if (elem.requestFullscreen) {
            elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) { /* Safari */
            elem.webkitRequestFullscreen();
        }
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) { /* Safari */
            document.webkitExitFullscreen();
        }
    }
});

// Set-up the export button
d3.select('#saveButton').on('click', function () {  

    let elW = document.getElementById("chart").offsetWidth;
    let elH = document.getElementById("chart").offsetHeight;  

    html2canvas(document.querySelector('#chart'), {       
        width: elW, height: elH
    }).then(function (canvas) {
        var myImage = canvas.toDataURL();
        downloadURI(myImage, csvFileName +  ".jpeg");        
    });
});


function downloadURI(uri, name) {
    var link = document.createElement("a");

    link.download = name;
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    link.href = null;   
}

function reorderIOTargetArrays() {
    inputs = dimensions.filter(function (axisName) {
        let axisData = magnitudes.find(magnitudeObject => magnitudeObject.name === axisName);

        return axisData.io.toLowerCase() === "input";
    });

    outputs = dimensions.filter(function (axisName) {
        let axisData = magnitudes.find(magnitudeObject => magnitudeObject.name === axisName);

        return axisData.io.toLowerCase() === "output";
    });

    targets = [];
    dimensions.map(function (axisName) {
        let axisData = magnitudes.find(magnitudeObject => magnitudeObject.name === axisName);

        if (axisData.target !== null) targets.push(axisData);
    });
}

function reload() {
    let axes = d3.selectAll(".dimension");

    if (axes[0].length > 0 || loadedData) {
        var element = document.getElementById('uploader');
        var event = new Event('change');
        element.dispatchEvent(event);
    }    
}

function resetBrushes() {
    //Reset Brushes
    d3.selectAll(".brush")
        .each(function (d) {
            d3.select(this).call(yscale[d].brush = d3.svg.multibrush()
                .extentAdaption(resizeExtent)
                .y(yscale[d]).on("brush", function () {
                    if (tableSelect.length === 0) {
                        brushing = true;
                        brush();
                    }
                })
            );
        })
        .selectAll("rect").call(resizeExtent);
}

function getTicks(startValue, stopValue, cardinality) {
    var arr = [];
    var step = (stopValue - startValue) / (cardinality - 1);
    for (var i = 0; i < cardinality; i++) {
        arr.push(Math.round((startValue + (step * i)) * 1000) / 1000);
    }
    return arr;
}

function between(x, min, max) {
    return x >= min && x <= max;
}

const setupBrushes = (group) => {
    svg.selectAll(".dimension").append("svg:g")
        .attr("class", "brush")
        .each(function (d) {
            d3.select(this).call(yscale[d].brush =
                d3.svg.multibrush()
                    .extentAdaption(resizeExtent)
                    .y(yscale[d]).on("brush", function () {
                        if (tableSelect.length === 0) {
                            brushing = true;
                            brush();
                        }
                    }));
        })
        .selectAll("rect").call(resizeExtent);


    group.selectAll(".extent")
        .append("title")
        .text("Drag or resize this filter");

    d3.selectAll(".brush")
        .on("mousedown", () => {
            clickedOnBrush = true;
        });

    d3.selectAll(".brush")
        .on("click", () => {
            brush();
        });

    d3.selectAll(".axis-label")
        .on("mousedown", () => {           
            clickedOnBrush = false;
            brushing = false;
        })  
}

function updateBrushes() {
    d3.selectAll(".brush")
        .each(function (d) {
            d3.select(this).call(yscale[d].brush = d3.svg.multibrush()
                .extentAdaption(resizeExtent)
                .y(yscale[d]).on("brush", function () {
                    if (tableSelect.length === 0) {
                        brushing = true;
                        brush();
                    }
                })
            );
        })
}

function getColorArray(values) {   

    if (values.length === 1) {
        return ["#0c74bb"]
    }
    else if (values.length === 2) {
        return ["#98c11d", "#0076bd"]
    }
    else if (values.length === 3) {
        return ["#98c11d", "#33735f", "#0076bd"]
    }
    else {
        return ["#98c11d", "#33735f", "#0076bd"];
    }
}

function displayErrorMsgOnDelete(group) {
    alert("Unable to remove category. At least one category of " + group + " is required.");
}

function displayErrorMsgOnLoad(group) {
    alert("Unable to load graphic. At least one category of " + group + " is required. Check your .csv file.");
}

function checkValues(dimension) {
    let values = [];

    data.map(function (d) {
        values.push(d[dimension])
    });

    return _.uniq(values).some(function (d) {
        return _.isNumber(d)
    });       
}