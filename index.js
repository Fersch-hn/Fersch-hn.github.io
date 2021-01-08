// Parallel Coordinates
// Copyright (c) 2012, Kai Chang
// Released under the BSD License: http://opensource.org/licenses/BSD-3-Clause
var width = document.body.clientWidth,
    height = d3.max([document.body.clientHeight * .5, 240]);

var m = [120, 40, 35, 40],
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
    labels = ["INPUT", "OUTPUT"],
    magnitudes = [],
    inputs = [],
    outputs = [],
    targets = [],
    csvFileName;    

//HSL
var colors = {
    "test": [225, 53, 70],
    "background": [225, 5, 59]
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
foreground.strokeStyle = "rgba(0,100,160,0.1)";
foreground.lineWidth = 1.7;
foreground.fillText("Loading...", w / 2, h / 2);

// Highlight canvas for temporary interactions
highlighted = document.getElementById('highlight').getContext('2d');
highlighted.strokeStyle = "rgba(0,100,160,1)";
highlighted.lineWidth = 4;

// Background canvas
background = document.getElementById('background').getContext('2d');
background.strokeStyle = "rgba(85,72,72,0.7)";
background.lineWidth = 1.7;

// SVG for ticks, labels, and interactions
var svg = d3.select("svg")
    .attr("width", w + m[1] + m[3])
    .attr("height", h + m[0] + m[2])
    .append("svg:g")
    .attr("transform", "translate(" + m[3] + "," + m[0] + ")")

var styles = "@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@100;300;400;500;700;900');"
    + "@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@100;200;300;400;500;600;700;800;900');";
    svg.append('defs')
        .append('style')
        .attr('type', 'text/css')
        .text(styles); 

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
        if (_.isNumber(data[0][k])) {
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

    // Add a group element for each dimension.
    var g = svg.selectAll(".dimension")
        .data(dimensions)
        .enter().append("svg:g")
        .attr("class", function (d) { return "dimension " + d.replace(/ /g, "_") })
        .attr("transform", function (d) { return "translate(" + xscale(d) + ")"; })
        .call(d3.behavior.drag()
            .on("dragstart", function (d) {
                if (!brushing) {
                    dragging[d] = this.__origin__ = xscale(d);
                    this.__dragged__ = false;                    
                }
            })
            .on("drag", function (d) {
                if (!brushing) {
                    dragging[d] = Math.min(w, Math.max(0, this.__origin__ += d3.event.dx));
                    //Cannot drag Output to Input
                    if (magnitudes.find(x => x.name === d).io === "Input") {
                        outOfSpace = position(d) >= firstOutputPosition;
                    }
                    else {
                        outOfSpace = position(d) <= lastInputPosition;
                    }

                    if (!outOfSpace) {
                        dimensions.sort(function (a, b) {
                            return position(a) - position(b);
                        });
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
                if (!brushing) {
                    if (!this.__dragged__) {
                        // no movement, invert axis                       
                        refAxis = d;
                    } else {
                        // reorder axes
                        d3.select(this).transition().attr("transform", "translate(" + xscale(d) + ")");
                        var extent = yscale[d].brush.extent();
                    }

                    // remove axis if dragged all the way left
                    if (dragging[d] < 12 || dragging[d] > w - 12) {
                        remove_axis(d, g);

                        //Inputs, Outputs, Targets
                        removeFromArrays(d);                        
                    }

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

                    delete this.__dragged__;
                    delete this.__origin__;
                    delete dragging[d];
                }
            }))
    
    //Group for Inputs and Outputs
    var columnKeys = Object.keys(data[0]);

    inputs = [];
    outputs = [];
    columnKeys.map(function (d) {
        let obj = magnitudes.find(m => m.name === d);

        if (obj.io === "Input") inputs.push(d);
        else if (obj.io === "Output") outputs.push(d);
    });    

    //Get Targets Axes Names
    targets = magnitudes.filter(x => x.target !== null);   

    // Add an axis and title.
    g.append("svg:g")        
        .attr("class", "axis font-RM15 fill4")
        .attr("transform", "translate(0,0)")
        .each(function (d) {
            d3.select(this).call(axis.scale(yscale[d]));
        })
        .style("font-size", "17px")
        .style('font-weight', '700')
        .style('font-family', '"Roboto"')   
        .style('fill', "#4e4f4f")
        .append("svg:text")        
        .attr("text-anchor", "middle")
        .attr("class", "axis-label")
        //Change Label Spacing.
        .attr("y", -50)
        .attr("x", 0)            
        .text(String)
        .append("title")
        .text("Click to invert. Drag to reorder");

    //Tick style font
    g.selectAll(".tick")
        .style("font-size", "15px")
        .style('font-weight', '500')
        .style('font-family', '"Roboto"') 
        .style('fill', "#58595b")
  
    //Add Extra Labels
    //Measure Magnitudes
    g.append("svg:g")
        .append("text")
        .attr("text-anchor", "middle")
        .style("font-size", "15px")
        .style('font-weight', '500')
        .style('font-family', '"Roboto"')
        .style('fill', "#969696")
        .attr('class', 'magnitude font-RR15 fill7')
        .attr('y', -30)
        .attr('x', 0)
        .text((d) => {
            let obj = magnitudes.find(m => m.name === d);
            return obj.value;
        })

    //Target    
    g.append("svg:g")
        .append("text")
        .attr("text-anchor", "middle")
        .style("font-size", "15px")
        .style('font-weight', '500')
        .style('font-family', '"Roboto"')
        .style('fill', "#969696")
        .attr('class', 'target-value font-RR15 fill7')
        .attr('y', -10)
        .attr('x', 0)
        .text((d) => {
            let obj = magnitudes.find(m => m.name === d);
            if (obj.target === null) { return " " }
            else { return obj.target; }
        });

    // Add and store a brush for each axis.
    g.append("svg:g")
        .attr("class", "brush")
        .each(function (d) {
            d3.select(this).call(yscale[d].brush = d3.svg.multibrush()
                .extentAdaption(resizeExtent)
                .y(yscale[d]).on("brush", function () {
                    brushing = true;
                    brush();
                })
            );
        })
        .selectAll("rect").call(resizeExtent);

    g.selectAll(".extent")
        .append("title")
        .text("Drag or resize this filter");

    legend = create_legend(colors, brush);

    //Box shadows
    var defs = svg.append("defs");

    var filter = defs.append("filter")
        .attr("id", "dropshadow")

    filter.append("feGaussianBlur")
        .attr("in", "SourceAlpha")
        .attr("stdDeviation", 4)
        .attr("result", "blur");
    filter.append("feOffset")
        .attr("in", "blur")
        .attr("dx", 2)
        .attr("dy", 2)
        .attr("result", "offsetBlur");

    var feMerge = filter.append("feMerge");

    feMerge.append("feMergeNode")
        .attr("in", "offsetBlur")
    feMerge.append("feMergeNode")
        .attr("in", "SourceGraphic");

    // Render full foreground
    brush();

   //Background Lines
    paths(data, background, brush_count, true);  

    //Input/Output Labels
    drawLabels();
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

function create_legend(colors, brush) {
    // create legend
    var legend_data = d3.select("#legend")
        .html("")
        .selectAll(".row")
        .data(_.keys(colors).sort())

    // filter by group
    var legend = legend_data
        .enter().append("div")
        .attr("title", "Hide group")
        .on("click", function (d) {
            // toggle food group
            if (_.contains(excluded_groups, d)) {
                d3.select(this).attr("title", "Hide group")
                excluded_groups = _.difference(excluded_groups, [d]);
                brush();
            } else {
                d3.select(this).attr("title", "Show group")
                excluded_groups.push(d);
                brush();
            }
        });

    legend
        .append("span")
        .style("background", function (d, i) { return color("test", 0.85) })
        .attr("class", "color-bar");

    legend
        .append("span")
        .attr("class", "tally")
        .text(function (d, i) { return 0 });

    legend
        .append("span")
        .text(function (d, i) { return " " + d });

    return legend;
}

// render polylines i to i+render_speed 
function render_range(selection, i, max, opacity, ctx) {
    
    let isForeground = ctx === foreground;
    selection.slice(i, max).forEach(function (d) {
        let pColor;

        if (isForeground) pColor = myColor(d[refAxis]);
        else pColor = color("background", 0.2);       
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
        else yscale[d].range([h, 0]);

        d3.selectAll('.label')
            .filter(function (p) { return p == d; })
            .style("text-decoration", null);
        yscale[d].inverted = false;
    } else {
        if (ordinal.includes(d)) yscale[d].rangePoints([0, h], .1);
        else yscale[d].range([0, h]);
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
    var x0 = xscale(dimensions[0]) - 15,
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
    ctx.lineTo(x0 + 15, y0);                               // right edge
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
   
    //Line Coloring   
    //Reference Axis for coloring order
    refAxisValues = [];
    if (!refAxis) {
        refAxis = dimensions[dimensions.length - 1];
    }

    data.map(function (d) {
        refAxisValues.push(d[refAxis]);
    });

    //Scale if numerical or ordinal
    if (_.isNumber(refAxisValues[0])) {

        //Get Range
        let min = Math.min(...refAxisValues),
            max = Math.max(...refAxisValues);

        //Scale Colors
        x0 = d3.scaleQuantize()
            .domain([max, min])
            .range(["#98c11d", "#33735f", "#0c74bb", "#0c3c5e", "#032135"]);

        myColor = d3.scaleSequential().domain([max, min])
            .interpolator(d3.interpolateRgbBasis(x0.range()));
    }
    else {
        refAxisValues.sort();

        myColor = d3.scaleOrdinal().domain(refAxisValues)
            .range(["#98c11d", "#0c74bb", "#33735f", "#0c3c5e", "#032135"]);
    }

    //Remove existing Boxes
    d3.selectAll(".box").remove();        
    drawBoxes();      

    brush_count++;
    var actives = dimensions.filter(function (p) { return !yscale[p].brush.empty(); }),
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
    let selected = [];   
    data
        .filter(function (d) {
            return !_.contains(excluded_groups, d.group);
        })
        .map(function (d) {
            return actives.every(function (p, i) {
                return extents[i].some(function (e) {
                    return e[0] <= d[p] && d[p] <= e[1];
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

    //Check tableSelections
    if (tableSelect.length > 0) {
        highlightSelected = true;
        selected = tableSelect
    }

    if (selected.length < data.length && selected.length > 0) {
        d3.select("#keep-data").attr("disabled", null);
        d3.select("#exclude-data").attr("disabled", null);
    } else {
        d3.select("#keep-data").attr("disabled", "disabled");
        d3.select("#exclude-data").attr("disabled", "disabled");
    };

    // total by food group
    var tallies = _(selected)
        .groupBy(function (d) { return d.group; })

    // include empty groups
    _(colors).each(function (v, k) { tallies[k] = tallies[k] || []; });

    legend
        .style("text-decoration", function (d) { return _.contains(excluded_groups, d) ? "line-through" : null; })
        .attr("class", function (d) {
            return (tallies[d].length > 0)
                ? "row"
                : "row off";
        });

    legend.selectAll(".color-bar")
        .style("width", function (d) {
            return Math.ceil(600 * tallies[d].length / data.length) + "px"
        });

    legend.selectAll(".tally")
        .text(function (d, i) { return tallies[d].length });

    drawTable(selected, data);   

    // Render selected lines
    paths(selected, foreground, brush_count, true);    
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
    // update brushes
    if (d) {
        var brush_el = d3.selectAll(".brush")
            .filter(function (key) { return key == d; });
        // single tick
        if (extent) {
            // restore previous extent
            brush_el.call(yscale[d].brush = d3.svg.multibrush().extentAdaption(resizeExtent).y(yscale[d]).on("brush", brush));
        } else {
            brush_el.call(yscale[d].brush = d3.svg.multibrush().extentAdaption(resizeExtent).y(yscale[d]).on("brush", brush));
        }
    } else {
        // all ticks
        d3.selectAll(".brush")
            .each(function (d) {
                d3.select(this).call(yscale[d].brush = d3.svg.multibrush().extentAdaption(resizeExtent).y(yscale[d]).on("brush", brush));
            })
    }

    brush_count++;
    show_ticks();

    // update axes
    d3.selectAll(".axis")
        .each(function (d, i) {
            // hide lines for better performance
            d3.select(this).selectAll('line').style("display", "none");

            // transition axis numbers
            d3.select(this)
                .transition()
                .duration(720)
                .call(axis.scale(yscale[d]));

            // bring lines back
            d3.select(this).selectAll('line').transition().delay(800).style("display", null);

            d3.select(this)
                .selectAll('text')
                .style('font-weight', null)
                .style('font-size', null)
                .style('display', null);
        });
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

// scale to window size
window.onresize = function () {
    width = document.body.clientWidth,
        height = d3.max([document.body.clientHeight * .5 , 240]);

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
        yscale[d].range([h, 0], .1);
    });   

    d3.selectAll(".dimension")
        .attr("transform", function (d) { return "translate(" + xscale(d) + ")"; })
    // update brush placement
    d3.selectAll(".brush")
        .each(function (d) {
            d3.select(this).call(yscale[d].brush = d3.svg.multibrush()
                .extentAdaption(resizeExtent)
                .y(yscale[d]).on("brush", function () {
                    brushing = true;
                    brush();
                })
            );
        })     

    brush_count++;

    // update axis placement
    axis = axis.ticks(1 + height / 50),
        d3.selectAll(".axis")
            .each(function (d) { d3.select(this).call(axis.scale(yscale[d])); });   

    // render data
    brush();

    //Background Lines
    paths(data, background, brush_count, true);   

    //Input/Output Labels
    drawLabels();

    //Tick style font
    d3.selectAll(".tick")
        .style("font-size", "15px")
        .style('font-weight', '500')
        .style('font-family', '"Roboto"')
        .style('fill', "#58595b")
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

d3.select("#keep-data").on("click", keep_data);
d3.select("#exclude-data").on("click", exclude_data);
d3.select("#export-data").on("click", export_csv);
d3.select("#search").on("keyup", brush);


// Appearance toggles
d3.select("#hide-ticks").on("click", hide_ticks);
d3.select("#show-ticks").on("click", show_ticks);
d3.select("#dark-theme").on("click", dark_theme);
d3.select("#light-theme").on("click", light_theme);

function hide_ticks() {
    d3.selectAll(".axis g").style("display", "none");
    //d3.selectAll(".axis path").style("display", "none");
    d3.selectAll(".background").style("visibility", "hidden");
    d3.selectAll("#hide-ticks").attr("disabled", "disabled");
    d3.selectAll("#show-ticks").attr("disabled", null);
};

function show_ticks() {
    d3.selectAll(".axis g").style("display", null);
    //d3.selectAll(".axis path").style("display", null);
    d3.selectAll(".background").style("visibility", null);
    d3.selectAll("#show-ticks").attr("disabled", "disabled");
    d3.selectAll("#hide-ticks").attr("disabled", null);
};

function dark_theme() {
    d3.select("body").attr("class", "dark");
    d3.selectAll("#dark-theme").attr("disabled", "disabled");
    d3.selectAll("#light-theme").attr("disabled", null);
}

function light_theme() {
    d3.select("body").attr("class", null);
    d3.selectAll("#light-theme").attr("disabled", "disabled");
    d3.selectAll("#dark-theme").attr("disabled", null);
}

function search(selection, str) {
    pattern = new RegExp(str, "i")
    return _(selection).filter(function (d) { return pattern.exec(d.name); });
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

function drawTable(selected, data) {

    data.sort(function (a, b) {
        if (containsObject(a, selected) && !(containsObject(b, selected))) { return -1 }
        else if (containsObject(a, selected) && containsObject(b, selected)) { return 0; }
        else if (!(containsObject(a, selected)) && (containsObject(b, selected))) { return 1; }
    });

    //Remove Existing Table
    d3.select("#table div").remove();

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
        .attr("class", "font-RB17 fill3")
        .text(function (d) { return d; });

    var rows, row_entries, row_entries_no_anchor, row_entries_with_anchor;

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
        .attr("class", "font-RR17 fill7");

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

function drawBoxes() {

    let spaceBetweenAxes = xscale(inputs[1]) - xscale(inputs[0]);
    let lastOutputPosition = xscale(outputs[outputs.length - 1]);
    let firstOutputPosition = xscale(outputs[0]);

    //Extra Space Between last Axis and svg end.
    let extraSpace = width - lastOutputPosition - m[3] - m[1];

    let wInputBox = firstOutputPosition - (spaceBetweenAxes * 0.6);
    let wOutputBox = lastOutputPosition - firstOutputPosition + (spaceBetweenAxes * 0.4) + extraSpace;
    let xOutputRect = firstOutputPosition + m[1] - (spaceBetweenAxes * 0.4);

    //Inputs Box
    drawRect(m[1], wInputBox, height);

    //Outputs Box
    drawRect(xOutputRect, wOutputBox, height);
}

function resizeExtent(selection) {
    selection
        .attr("x", -19)
        .attr("width", 37);
}

function drawRect(x, rectWidth, rectHeight) {
    d3.select("svg")
        .append("rect")
        .attr("class", "box")
        .attr("x", x)
        .attr("y", 10)
        .attr("width", rectWidth)
        .attr("height", rectHeight - 10)
        .attr("stroke", "#8f8f8f")
        .attr("stroke-width", "0.2")
        .attr("fill", "none")
        .attr("filter", "url(#dropshadow)");
}

function drawLabels() {
    let inputLabelPosition = xscale(inputs[inputs.length - 1]) - ((xscale(inputs[inputs.length - 1]) - xscale(inputs[0])) / 2);
    let outputLabelPosition = xscale(outputs[outputs.length - 1]) - ((xscale(outputs[outputs.length - 1]) - xscale(outputs[0])) / 2);

    // Add a Label for each input output.  
    d3.selectAll(".dimensionIO").remove();

    svg.selectAll(".dimensionIO")
        .data(labels)
        .enter().append("svg:g")
        .attr("class", "dimensionIO")
        .attr("transform", function (d, i) {
            if (d === "INPUT") return "translate( " + inputLabelPosition + " )";
            else if (d === "OUTPUT") return "translate( " + outputLabelPosition + " )";
        })
        .append("text")
        .attr("text-anchor", "middle")
        //.attr('class', 'group-label font-BB17 fill2 spacing1')
        .style("font-size", "17px")
        .style('font-weight', '700')
        .style('font-family', '"Barlow"')
        .style('fill', "#333333")
        .style('letter-spacing', "2px")
        .attr('y', -80)
        .attr('x', 0)
        .text(String);

    //Add Target Label
    d3.selectAll(".target-label").remove();
    svg.append("svg:g")
        .append("text")
        .attr("text-anchor", "middle")
        .style("font-size", "17px")
        .style('font-weight', '700')
        .style('font-family', '"Roboto"')
        .style('fill', "#4e4f4f")
        .attr('class', 'font-RB17 fill3 target-label')
        .attr("transform", function () {           
            return "translate( " + xscale(targets[0].name) + " )";
        })
        .attr('y', -10)
        .attr('x', -60)
        .text("Target:");
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

// Set-up the export button
d3.select('#saveButton').on('click', function () {  

    html2canvas(document.querySelector('#chart')).then(function (canvas) {
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

    //after creating link you should delete dynamic link
    //clearDynamicLink(link); 
}