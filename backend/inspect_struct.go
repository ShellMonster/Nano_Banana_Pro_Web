//go:build tools
// +build tools

package main

import (
	"fmt"
	"google.golang.org/genai"
	"reflect"
)

func main() {
	t := reflect.TypeOf(genai.BaseURLParameters{})
	for i := 0; i < t.NumField(); i++ {
		fmt.Println(t.Field(i).Name)
	}
}
